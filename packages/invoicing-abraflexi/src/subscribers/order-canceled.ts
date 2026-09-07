import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { createCreditNoteInAbraFlexiWorkflow } from "../workflows/create-credit-note-in-abra-flexi.js"

export default async function abraFlexiOrderCanceledHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>): Promise<void> {
  await createCreditNoteInAbraFlexiWorkflow(container).run({
    input: { orderId: data.id, triggeredBy: "order_canceled" },
  })
}

export const config: SubscriberConfig = {
  event: "order.canceled",
}
