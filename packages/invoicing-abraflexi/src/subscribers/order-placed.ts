import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createInvoiceInAbraFlexiWorkflow } from "../workflows/create-invoice-in-abra-flexi.js"
import { recordPaymentInAbraFlexiWorkflow } from "../workflows/record-payment-in-abra-flexi.js"

// Invoices payments that are already captured when the order is placed. A
// provider that captures during authorization (e.g. payment-comgate with
// capture: "automatic") is captured inside cart completion by the payment
// module itself, which never emits payment.captured -- only the admin-triggered
// capturePaymentWorkflow does. Without this, such orders were never invoiced
// (first live Comgate test order, 2026-10-25).
//
// Payments captured later still go through the payment.captured subscriber.
// Both paths are safe to overlap: the invoice workflow skips an order that
// already has abra_flexi_invoice_id, and payment recording skips payment ids
// already in abra_flexi_recorded_payment_ids.
export default async function abraFlexiOrderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>): Promise<void> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "payment_collections.payments.id", "payment_collections.payments.captured_at"],
    filters: { id: data.id },
  })

  type OrderPayment = { id: string; captured_at?: Date | string | null } | null
  type OrderWithPayments = { payment_collections?: Array<{ payments?: OrderPayment[] } | null> }
  const order = orders[0] as OrderWithPayments | undefined
  const capturedPaymentIds = (order?.payment_collections ?? [])
    .flatMap((collection) => collection?.payments ?? [])
    .filter((payment): payment is NonNullable<OrderPayment> => !!payment?.captured_at)
    .map((payment) => payment.id)

  for (const paymentId of capturedPaymentIds) {
    await createInvoiceInAbraFlexiWorkflow(container).run({ input: { paymentId } })
    await recordPaymentInAbraFlexiWorkflow(container).run({ input: { paymentId } })
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
