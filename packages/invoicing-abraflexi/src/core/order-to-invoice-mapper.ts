import { isValidIco } from "@medusa-cz/shared"
import type { OrderDTO } from "@medusajs/framework/types"
import { ABRA_FLEXI_DEFAULT_DUE_DAYS, CZ_VAT_RATE_BASIC } from "../types.js"
import type { AbraFlexiCustomer, AbraFlexiInvoiceLine, AbraFlexiInvoicePayload } from "../types.js"

export interface AbraFlexiMapperConfig {
  vatPayer: boolean
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// Flexi identifiers for our documents. These are Flexi *external ids* (`ext:<prefix>:<value>`),
// sent as the record `id`, not `code:` values: a document's `kod` ("Interní číslo") is capped
// at 20 characters, which `order-<medusa order id>` (38) exceeds -- Flexi rejected every
// invoice (found on the reet-server instance, 2026-10-25). With an external id, Flexi numbers
// the document from its own series (e.g. VF1-0001/2026) and still upserts on a repeated PUT.
export function abraFlexiExternalCodeForOrder(orderId: string): string {
  return `ext:medusa-order:${orderId}`
}

export function creditNoteExternalCodeForRefund(orderId: string, refundId: string): string {
  return `ext:medusa-credit:${orderId}:${refundId}`
}

export function mapOrderToAbraFlexiInvoice(
  order: OrderDTO,
  config: AbraFlexiMapperConfig
): AbraFlexiInvoicePayload {
  const address = order.billing_address ?? order.shipping_address
  const nameFromAddress = [address?.first_name, address?.last_name].filter(Boolean).join(" ").trim()
  const customerName = nameFromAddress || address?.company || order.email || "Unknown customer"

  const customer: AbraFlexiCustomer = {
    name: customerName,
    street: address?.address_1 ?? undefined,
    city: address?.city ?? undefined,
    postalCode: address?.postal_code ?? undefined,
    countryCode: address?.country_code?.toUpperCase() ?? undefined,
  }

  const metadata = order.metadata as Record<string, unknown> | null | undefined
  const ico = typeof metadata?.ico === "string" ? metadata.ico : undefined
  if (ico && isValidIco(ico)) {
    customer.ico = ico
    const dic = typeof metadata?.dic === "string" ? metadata.dic : undefined
    if (dic) {
      customer.dic = dic
    }
  }

  // quantity is a BigNumberValue; a missing one must fail the step rather than reach Flexi,
  // which would bill it as 1 (invoice) or reject it as null (credit note).
  const itemLines: AbraFlexiInvoiceLine[] = (order.items ?? []).map((item) => {
    const quantity = Number(item.quantity)
    if (item.quantity == null || !Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Abra Flexi: order "${order.id}" item "${item.id}" has no valid quantity`)
    }
    return {
      name: item.title,
      quantity,
      unitPrice: item.unit_price,
      vatRate: config.vatPayer ? CZ_VAT_RATE_BASIC : undefined,
    }
  })

  // Shipping charges live on order.shipping_methods, not order.items -- map them
  // into their own invoice lines (one per shipping method) so the invoice isn't
  // under-billed by the shipping amount. `amount` is a BigNumberValue (BigNumberJS |
  // number | string | IBigNumber), unlike OrderLineItemDTO.unit_price, hence Number(...).
  const shippingLines: AbraFlexiInvoiceLine[] = (order.shipping_methods ?? []).map((method) => ({
    name: method.name,
    quantity: 1,
    unitPrice: Number(method.amount),
    vatRate: config.vatPayer ? CZ_VAT_RATE_BASIC : undefined,
  }))

  const lines: AbraFlexiInvoiceLine[] = [...itemLines, ...shippingLines]

  const issueDate = new Date()
  const dueDate = new Date(issueDate)
  dueDate.setDate(dueDate.getDate() + ABRA_FLEXI_DEFAULT_DUE_DAYS)

  return {
    externalCode: abraFlexiExternalCodeForOrder(order.id),
    currency: order.currency_code.toUpperCase(),
    issueDate: isoDate(issueDate),
    dueDate: isoDate(dueDate),
    customer,
    lines,
    vatPayer: config.vatPayer,
  }
}
