import type {
  AbraFlexiInvoicePayload,
  AbraFlexiInvoiceResult,
  AbraFlexiOptions,
  AbraFlexiRecordPaymentPayload,
  AbraFlexiRecordPaymentResult,
  AbraFlexiCreditNotePayload,
  AbraFlexiCreditNoteResult,
} from "../types.js"
import {
  ABRA_FLEXI_VAT_RATE_CODE_BASIC,
  ABRA_FLEXI_PAYMENT_STATUS_CODE_PAID_MANUALLY,
  ABRA_FLEXI_DOCUMENT_TYPE_CODE_CREDIT_NOTE,
} from "../types.js"

export class AbraFlexiApiError extends Error {
  readonly name = "AbraFlexiApiError"
  constructor(
    readonly status: number,
    message: string,
    readonly retryable = false
  ) {
    super(message)
  }
}

interface AbraFlexiWriteResult {
  id: string
  errors?: { message: string; code?: string }[]
}

interface AbraFlexiWriteResponse {
  winstrom?: {
    success?: boolean
    results?: AbraFlexiWriteResult[]
  }
}

export class AbraFlexiClient {
  private readonly base: string
  private readonly company: string
  private readonly auth: string
  private readonly fetchFn: typeof fetch
  private readonly requestTimeoutMs: number

  constructor(opts: AbraFlexiOptions & { fetchFn?: typeof fetch }) {
    this.base = opts.baseUrl.replace(/\/+$/, "")
    this.company = opts.company
    this.auth = "Basic " + Buffer.from(`${opts.username}:${opts.password}`).toString("base64")
    this.fetchFn = opts.fetchFn ?? fetch
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 30000
    if (
      !Number.isSafeInteger(this.requestTimeoutMs) ||
      this.requestTimeoutMs < 1 ||
      this.requestTimeoutMs > 300000
    )
      throw new Error("Abra Flexi requestTimeoutMs must be between 1 and 300000")
  }

  // The deadline owns fetch AND body consumption. Racing also bounds a broken
  // transport/body implementation which ignores its AbortSignal.
  private async request<T>(
    url: string,
    init: RequestInit,
    consume: (res: Response) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let rejectAbort!: (error: Error) => void
    const stopped = new Promise<never>((_, reject) => {
      rejectAbort = reject
    })
    const abort = () => {
      controller.abort()
      rejectAbort(
        new AbraFlexiApiError(
          0,
          "Abra Flexi request aborted or deadline exceeded; write outcome may be unknown",
          true
        )
      )
    }
    signal?.addEventListener("abort", abort, { once: true })
    try {
      if (signal?.aborted) {
        abort()
        return await stopped
      }
      timer = setTimeout(abort, this.requestTimeoutMs)
      return await Promise.race([
        (async () => consume(await this.fetchFn(url, { ...init, signal: controller.signal })))(),
        stopped,
      ])
    } catch (error) {
      if (error instanceof AbraFlexiApiError) throw error
      throw new AbraFlexiApiError(
        0,
        "Abra Flexi network or response-body error; write outcome may be unknown",
        true
      )
    } finally {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
    }
  }

  /** The issued invoice rendered by Flexi's default print report, as PDF bytes. */
  async getInvoicePdf(invoiceId: string, signal?: AbortSignal): Promise<Buffer> {
    return this.request(
      `${this.base}/c/${this.company}/faktura-vydana/${invoiceId}.pdf`,
      { method: "GET", headers: { Authorization: this.auth, Accept: "application/pdf" } },
      async (res) => {
        if (!res.ok)
          throw new AbraFlexiApiError(
            res.status,
            `Abra Flexi HTTP ${res.status} fetching invoice PDF`,
            res.status >= 500
          )
        return Buffer.from(await res.arrayBuffer())
      },
      signal
    )
  }

  async createInvoice(
    payload: AbraFlexiInvoicePayload,
    signal?: AbortSignal
  ): Promise<AbraFlexiInvoiceResult> {
    const invoice: Record<string, unknown> = {
      id: payload.externalCode,
      typDokl: "code:FAKTURA",
      datVyd: payload.issueDate,
      splatnost: payload.dueDate,
      mena: `code:${payload.currency}`,
      nazFirma: payload.customer.name,
    }
    if (payload.customer.street) invoice.ulice = payload.customer.street
    if (payload.customer.city) invoice.mesto = payload.customer.city
    if (payload.customer.postalCode) invoice.psc = payload.customer.postalCode
    if (payload.customer.countryCode) invoice.stat = `code:${payload.customer.countryCode}`
    if (payload.customer.ico) invoice.ic = payload.customer.ico
    if (payload.customer.dic) invoice.dic = payload.customer.dic

    // Replace, not append, the lines when this PUT upserts an existing invoice (retries).
    invoice["polozkyFaktury@removeAll"] = "true"
    invoice.polozkyFaktury = payload.lines.map((line) => ({
      "faktura-vydana-polozka": {
        nazev: line.name,
        mnozMj: line.quantity,
        cenaMj: line.unitPrice,
        ...(line.vatRate != null
          ? { typCenyDphK: "typCeny.bezDph", typSzbDphK: ABRA_FLEXI_VAT_RATE_CODE_BASIC }
          : {}),
      },
    }))

    const result = await this.putFakturaVydana(invoice, signal)
    return { id: result.id, code: payload.externalCode }
  }

  async recordPayment(
    payload: AbraFlexiRecordPaymentPayload,
    signal?: AbortSignal
  ): Promise<AbraFlexiRecordPaymentResult> {
    return this.putFakturaVydana(
      {
        id: payload.invoiceExternalCode,
        stavUhrK: ABRA_FLEXI_PAYMENT_STATUS_CODE_PAID_MANUALLY,
      },
      signal
    )
  }

  private async putFakturaVydana(
    record: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<{ id: string }> {
    return this.request(
      `${this.base}/c/${this.company}/faktura-vydana.json`,
      {
        method: "PUT",
        headers: { Authorization: this.auth, "Content-Type": "application/json" },
        body: JSON.stringify({ winstrom: { "faktura-vydana": record } }),
      },
      async (res) => {
        let parsed: AbraFlexiWriteResponse | undefined
        try {
          parsed = (await res.json()) as AbraFlexiWriteResponse
        } catch {
          parsed = undefined
        }
        const result = parsed?.winstrom?.results?.[0]
        if (!res.ok || parsed?.winstrom?.success === false)
          throw new AbraFlexiApiError(
            res.status,
            result?.errors?.[0]?.message ?? `Abra Flexi HTTP ${res.status}`,
            res.status >= 500
          )
        if (!result?.id)
          throw new AbraFlexiApiError(
            res.status,
            "Abra Flexi: write response missing result id",
            false
          )
        return { id: String(result.id) }
      },
      signal
    )
  }

  async createCreditNote(
    payload: AbraFlexiCreditNotePayload,
    signal?: AbortSignal
  ): Promise<AbraFlexiCreditNoteResult> {
    const creditNote: Record<string, unknown> = {
      id: payload.externalCode,
      typDokl: `code:${ABRA_FLEXI_DOCUMENT_TYPE_CODE_CREDIT_NOTE}`,
      datVyd: payload.issueDate,
      splatnost: payload.dueDate,
      mena: `code:${payload.currency}`,
      nazFirma: payload.customer.name,
    }
    if (payload.customer.street) creditNote.ulice = payload.customer.street
    if (payload.customer.city) creditNote.mesto = payload.customer.city
    if (payload.customer.postalCode) creditNote.psc = payload.customer.postalCode
    if (payload.customer.countryCode) creditNote.stat = `code:${payload.customer.countryCode}`
    if (payload.customer.ico) creditNote.ic = payload.customer.ico
    if (payload.customer.dic) creditNote.dic = payload.customer.dic

    creditNote["polozkyFaktury@removeAll"] = "true"
    creditNote.polozkyFaktury = payload.lines.map((line) => ({
      "faktura-vydana-polozka": {
        nazev: line.name,
        mnozMj: line.quantity,
        cenaMj: line.unitPrice,
        ...(line.vatRate != null
          ? { typCenyDphK: "typCeny.bezDph", typSzbDphK: ABRA_FLEXI_VAT_RATE_CODE_BASIC }
          : {}),
      },
    }))

    // PUT #1: create using a stable external identity. A lost response can
    // leave a document behind; recovery must reuse this same identity.
    const created = await this.putFakturaVydana(creditNote, signal)

    // PUT #2: link it to the original invoice by code. A failure here means
    // the credit note document *does* now exist in Abra Flexi, just unlinked
    // -- the error message says so explicitly (see spec's "orphaned dobropis"
    // note), since that's a materially different, worse failure mode than
    // "never created" and this package doesn't attempt to auto-delete or
    // auto-retry-link it.
    try {
      await this.putFakturaVydana(
        {
          id: payload.externalCode,
          "vytvor-vazbu-dobropis": {
            dobropisovanyDokl: payload.originalInvoiceExternalCode,
          },
        },
        signal
      )
    } catch (e) {
      if (e instanceof AbraFlexiApiError) {
        throw new AbraFlexiApiError(
          e.status,
          `Abra Flexi: credit note "${payload.externalCode}" (id "${created.id}") was created but linking it to invoice "${payload.originalInvoiceExternalCode}" failed: ${e.message}`,
          e.retryable
        )
      }
      throw e
    }

    return { id: created.id, code: payload.externalCode }
  }
}
