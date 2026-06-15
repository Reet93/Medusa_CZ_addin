import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { isValidIco } from "@medusa-cz/shared"

/**
 * M0 smoke subscriber — proves the `@medusa-cz/shared` workspace package
 * resolves, types, and runs from inside the demo backend. Not real domain
 * logic; it only exercises the open-core seam end to end.
 */
export default async function sharedSmokeHandler({
  event: { data },
}: SubscriberArgs<{ id: string }>) {
  // Exercise the shared IČO validator against the customer id payload so the
  // import is real (not tree-shaken away) and the symlink is proven at runtime.
  const sample = "25063677" // Seznam.cz a.s. — a known-valid IČO
  console.log(
    `[medusa-cz] shared smoke: customer ${data.id} placed an order; ` +
      `isValidIco("${sample}") = ${isValidIco(sample)}`,
  )
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
