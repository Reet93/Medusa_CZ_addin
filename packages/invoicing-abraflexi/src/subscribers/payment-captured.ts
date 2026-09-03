import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { createInvoiceInAbraFlexiWorkflow } from "../workflows/create-invoice-in-abra-flexi.js"

export default async function abraFlexiPaymentCapturedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>): Promise<void> {
  await createInvoiceInAbraFlexiWorkflow(container).run({ input: { paymentId: data.id } })
}

export const config: SubscriberConfig = {
  event: "payment.captured",
}
