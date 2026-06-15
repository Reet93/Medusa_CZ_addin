import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

/**
 * Order-placed subscriber — SKELETON (M0). In M4 this fetches the full order and
 * creates a Fakturoid invoice. Event name verified for Medusa 2.15 (verification doc §6).
 */
export default async function fakturoidOrderPlacedHandler({
  event: { data },
}: SubscriberArgs<{ id: string }>): Promise<void> {
  void data // M0: no-op skeleton
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
