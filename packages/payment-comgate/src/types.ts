import type { PaymentSessionStatus } from "@medusajs/framework/utils"

export type CaptureMode = "automatic" | "manual"

export interface ComgateOptions {
  merchant: string
  secret: string
  test?: boolean
  capture?: CaptureMode // default "automatic"
  method?: string // default "ALL"
  country?: string // default "CZ"
}

export type ComgateStatus = "PENDING" | "PAID" | "AUTHORIZED" | "CANCELLED"

export interface ComgateCreateInput {
  price: number // MINOR units (haléře)
  curr: string // upper-case ISO, e.g. "CZK"
  label: string // 1-16 chars
  refId: string
  email?: string
  prepareOnly: true
  preauth?: boolean
  method?: string
  country?: string
  test?: boolean
  url_paid?: string
  url_cancelled?: string
  url_pending?: string
}

export interface ComgateCreateResult {
  code: number
  message: string
  transId: string
  redirect: string
}

export interface ComgateStatusResult {
  code: number
  message: string
  transId: string
  status: ComgateStatus
  price: number
  curr: string
  refId: string
  test: boolean
}

// The data we persist on the Medusa payment session.
export interface ComgateSessionData extends Record<string, unknown> {
  transId: string
  redirect_url: string
  status?: ComgateStatus
}

export const COMGATE_BASE_URL = "https://payments.comgate.cz/v2.0"
