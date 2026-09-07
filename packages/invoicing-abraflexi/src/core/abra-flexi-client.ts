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

  constructor(opts: AbraFlexiOptions & { fetchFn?: typeof fetch }) {
    this.base = opts.baseUrl.replace(/\/+$/, "")
    this.company = opts.company
    this.auth = "Basic " + Buffer.from(`${opts.username}:${opts.password}`).toString("base64")
    this.fetchFn = opts.fetchFn ?? fetch
  }

  async createInvoice(payload: AbraFlexiInvoicePayload): Promise<AbraFlexiInvoiceResult> {
    const invoice: Record<string, unknown> = {
      id: `code:${payload.externalCode}`,
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

    let res: Response
    try {
      res = await this.fetchFn(`${this.base}/c/${this.company}/faktura-vydana.json`, {
        method: "PUT",
        headers: { Authorization: this.auth, "Content-Type": "application/json" },
        body: JSON.stringify({ winstrom: { "faktura-vydana": invoice } }),
      })
    } catch (e) {
      throw new AbraFlexiApiError(0, `Abra Flexi network error: ${(e as Error).message}`, true)
    }

    let parsed: AbraFlexiWriteResponse | undefined
    try {
      parsed = (await res.json()) as AbraFlexiWriteResponse
    } catch {
      parsed = undefined
    }

    const result = parsed?.winstrom?.results?.[0]
    const retryable = res.status >= 500
    if (!res.ok || parsed?.winstrom?.success === false) {
      const message = result?.errors?.[0]?.message ?? `Abra Flexi HTTP ${res.status}`
      throw new AbraFlexiApiError(res.status, message, retryable)
    }
    if (!result?.id) {
      throw new AbraFlexiApiError(
        res.status,
        "Abra Flexi: create response missing result id",
        false
      )
    }
    return { id: String(result.id), code: payload.externalCode }
  }

  async recordPayment(
    payload: AbraFlexiRecordPaymentPayload
  ): Promise<AbraFlexiRecordPaymentResult> {
    let res: Response
    try {
      res = await this.fetchFn(`${this.base}/c/${this.company}/faktura-vydana.json`, {
        method: "PUT",
        headers: { Authorization: this.auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          winstrom: {
            "faktura-vydana": {
              id: `code:${payload.invoiceExternalCode}`,
              stavUhrK: `code:${ABRA_FLEXI_PAYMENT_STATUS_CODE_PAID_MANUALLY}`,
            },
          },
        }),
      })
    } catch (e) {
      throw new AbraFlexiApiError(0, `Abra Flexi network error: ${(e as Error).message}`, true)
    }

    let parsed: AbraFlexiWriteResponse | undefined
    try {
      parsed = (await res.json()) as AbraFlexiWriteResponse
    } catch {
      parsed = undefined
    }

    const result = parsed?.winstrom?.results?.[0]
    const retryable = res.status >= 500
    if (!res.ok || parsed?.winstrom?.success === false) {
      const message = result?.errors?.[0]?.message ?? `Abra Flexi HTTP ${res.status}`
      throw new AbraFlexiApiError(res.status, message, retryable)
    }
    if (!result?.id) {
      throw new AbraFlexiApiError(
        res.status,
        "Abra Flexi: payment-status update response missing result id",
        false
      )
    }
    return { id: String(result.id) }
  }

  // Shared by createCreditNote's two sequential PUTs (create, then link) below
  // -- NOT used by createInvoice/recordPayment above, which predate this
  // helper and are left untouched (same fetch/parse/error shape, just not
  // re-plumbed through this method, to avoid touching already-shipped
  // sub-project 2 code for a sub-project 3 change).
  private async putFakturaVydana(record: Record<string, unknown>): Promise<{ id: string }> {
    let res: Response
    try {
      res = await this.fetchFn(`${this.base}/c/${this.company}/faktura-vydana.json`, {
        method: "PUT",
        headers: { Authorization: this.auth, "Content-Type": "application/json" },
        body: JSON.stringify({ winstrom: { "faktura-vydana": record } }),
      })
    } catch (e) {
      throw new AbraFlexiApiError(0, `Abra Flexi network error: ${(e as Error).message}`, true)
    }

    let parsed: AbraFlexiWriteResponse | undefined
    try {
      parsed = (await res.json()) as AbraFlexiWriteResponse
    } catch {
      parsed = undefined
    }

    const result = parsed?.winstrom?.results?.[0]
    const retryable = res.status >= 500
    if (!res.ok || parsed?.winstrom?.success === false) {
      const message = result?.errors?.[0]?.message ?? `Abra Flexi HTTP ${res.status}`
      throw new AbraFlexiApiError(res.status, message, retryable)
    }
    if (!result?.id) {
      throw new AbraFlexiApiError(res.status, "Abra Flexi: write response missing result id", false)
    }
    return { id: String(result.id) }
  }

  async createCreditNote(payload: AbraFlexiCreditNotePayload): Promise<AbraFlexiCreditNoteResult> {
    const creditNote: Record<string, unknown> = {
      id: `code:${payload.externalCode}`,
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

    // PUT #1: create the credit note with its own line items. A failure here
    // means nothing was created in Abra Flexi -- the ordinary retryable/
    // permanent error shape, same as createInvoice.
    const created = await this.putFakturaVydana(creditNote)

    // PUT #2: link it to the original invoice by code. A failure here means
    // the credit note document *does* now exist in Abra Flexi, just unlinked
    // -- the error message says so explicitly (see spec's "orphaned dobropis"
    // note), since that's a materially different, worse failure mode than
    // "never created" and this package doesn't attempt to auto-delete or
    // auto-retry-link it.
    try {
      await this.putFakturaVydana({
        id: `code:${payload.externalCode}`,
        "vytvor-vazbu-dobropis": {
          dobropisovanyDokl: `code:${payload.originalInvoiceExternalCode}`,
        },
      })
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
