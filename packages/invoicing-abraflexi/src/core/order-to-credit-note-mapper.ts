import type { OrderDTO } from "@medusajs/framework/types"
import { CZ_VAT_RATE_BASIC } from "../types.js"
import type { AbraFlexiInvoicePayload } from "../types.js"
import {
  mapOrderToAbraFlexiInvoice,
  creditNoteExternalCodeForRefund,
  type AbraFlexiMapperConfig,
} from "./order-to-invoice-mapper.js"

export interface AbraFlexiRefundForCreditNote {
  id: string
  /** major units -- the caller converts RefundDTO's BigNumberValue with Number(...) first */
  amount: number
  note?: string | null
}

// Order-cancellation path: mirror the original invoice's own item + shipping
// lines, negated -- a full, honest storno of everything originally billed.
// Reuses mapOrderToAbraFlexiInvoice's line/customer/currency/date construction
// wholesale rather than duplicating it, then only negates quantities and swaps
// in the credit note's own externalCode.
export function mapOrderToFullCreditNote(
  order: OrderDTO,
  config: AbraFlexiMapperConfig,
  refundId: string
): AbraFlexiInvoicePayload {
  const invoice = mapOrderToAbraFlexiInvoice(order, config)
  return {
    ...invoice,
    externalCode: creditNoteExternalCodeForRefund(order.id, refundId),
    lines: invoice.lines.map((line) => ({ ...line, quantity: -line.quantity })),
  }
}

// Explicit payment-refund path: RefundDTO carries only a total amount, no
// order-line breakdown (verified in
// docs/superpowers/research/2026-09-07-abra-flexi-credit-notes-api-verification.md
// Part 2) -- so this is a single generic lump-sum line, not a guess at which
// order line was returned. Same vatPayer gating as regular invoice lines.
export function mapRefundToLumpSumCreditNote(
  order: OrderDTO,
  config: AbraFlexiMapperConfig,
  refund: AbraFlexiRefundForCreditNote
): AbraFlexiInvoicePayload {
  const invoice = mapOrderToAbraFlexiInvoice(order, config)
  const lineName = refund.note ? `Refund: ${refund.note}` : "Refund"
  return {
    ...invoice,
    externalCode: creditNoteExternalCodeForRefund(order.id, refund.id),
    lines: [
      {
        name: lineName,
        quantity: -1,
        unitPrice: refund.amount,
        vatRate: config.vatPayer ? CZ_VAT_RATE_BASIC : undefined,
      },
    ],
  }
}
