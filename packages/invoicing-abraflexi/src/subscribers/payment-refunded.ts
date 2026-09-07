import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { resolveOrderStepFn } from "../workflows/create-invoice-in-abra-flexi.js"
import { createCreditNoteInAbraFlexiWorkflow } from "../workflows/create-credit-note-in-abra-flexi.js"

export default async function abraFlexiPaymentRefundedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>): Promise<void> {
  const resolved = await resolveOrderStepFn({ paymentId: data.id }, { container })
  await createCreditNoteInAbraFlexiWorkflow(container).run({
    input: { orderId: resolved.output.order.id, triggeredBy: "payment_refunded" },
  })
}

export const config: SubscriberConfig = {
  event: "payment.refunded",
}
