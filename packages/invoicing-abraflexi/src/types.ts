export interface AbraFlexiOptions {
  /** e.g. "https://yourcompany.flexibee.eu" (cloud) or a self-hosted server URL, no trailing slash required */
  baseUrl: string
  /** company/evidence slug in the URL path, e.g. "yourcompany_s_r_o" */
  company: string
  username: string
  password: string
  /** default false — the business is currently "neplátce" (not VAT-registered) */
  vatPayer?: boolean
}

export interface AbraFlexiCustomer {
  name: string
  street?: string
  city?: string
  postalCode?: string
  /** ISO 3166-1 alpha-2, upper-case, e.g. "CZ" */
  countryCode?: string
  ico?: string
  dic?: string
}

export interface AbraFlexiInvoiceLine {
  name: string
  quantity: number
  /** major units, net of VAT */
  unitPrice: number
  /** CZ_VAT_RATE_BASIC when the invoice is VAT-payer; undefined when it isn't */
  vatRate?: number
}

export interface AbraFlexiInvoicePayload {
  /** our idempotency key, sent to Abra Flexi as the record's external id (see AbraFlexiClient) */
  externalCode: string
  /** ISO 4217, upper-case, e.g. "CZK" */
  currency: string
  /** YYYY-MM-DD */
  issueDate: string
  /** YYYY-MM-DD */
  dueDate: string
  customer: AbraFlexiCustomer
  lines: AbraFlexiInvoiceLine[]
  vatPayer: boolean
}

export interface AbraFlexiInvoiceResult {
  id: string
  code: string
}

// The current CZ statutory basic VAT rate (zákon č. 235/2004 Sb., o dani z přidané
// hodnoty, §47), kept here for reference. Marker value only — never sent to Abra
// Flexi (which resolves the real percentage server-side from
// ABRA_FLEXI_VAT_RATE_CODE_BASIC's rate class); used here only to decide whether
// the basic rate applies to a line (line.vatRate != null in abra-flexi-client.ts's
// createInvoice gates only *whether* that rate-class code is attached, not what
// percentage it represents). Editing this number does not change what gets invoiced.
export const CZ_VAT_RATE_BASIC = 0.21

// Abra Flexi's rate-class code for the basic VAT rate (winstrom `typSzbDphK` field),
// verified against https://podpora.flexibee.eu/en/articles/3935269-order-fulfillment-in-json-format
export const ABRA_FLEXI_VAT_RATE_CODE_BASIC = "typSzbDph.dphZakl"

// Net payment terms applied to every issued invoice. Not specified by the design spec;
// 14 days is the common CZ B2C default. Revisit if the business needs per-order terms.
export const ABRA_FLEXI_DEFAULT_DUE_DAYS = 14
