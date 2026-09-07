import type {
  AbraFlexiInvoicePayload,
  AbraFlexiInvoiceResult,
  AbraFlexiOptions,
  AbraFlexiRecordPaymentPayload,
  AbraFlexiRecordPaymentResult,
} from "../types.js"
import {
  ABRA_FLEXI_VAT_RATE_CODE_BASIC,
  ABRA_FLEXI_PAYMENT_STATUS_CODE_PAID_MANUALLY,
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
}
