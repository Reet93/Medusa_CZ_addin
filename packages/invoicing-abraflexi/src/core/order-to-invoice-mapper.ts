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

  const itemLines: AbraFlexiInvoiceLine[] = (order.items ?? []).map((item) => ({
    name: item.title,
    quantity: item.quantity,
    unitPrice: item.unit_price,
    vatRate: config.vatPayer ? CZ_VAT_RATE_BASIC : undefined,
  }))

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
    externalCode: `order-${order.id}`,
    currency: order.currency_code.toUpperCase(),
    issueDate: isoDate(issueDate),
    dueDate: isoDate(dueDate),
    customer,
    lines,
    vatPayer: config.vatPayer,
  }
}
