import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils"

/**
 * Packeta fulfillment provider — SKELETON (M0). No business logic yet.
 * Base methods are non-abstract (Medusa 2.15); we override only getFulfillmentOptions
 * to return an empty set so the provider loads. Real logic (pickup points, calculatePrice)
 * lands in M2. The #9598 calculatePrice flow is fixed in 2.15.x — no workaround needed
 * (docs/superpowers/research/2026-06-14-medusa-2.15-verification.md §4/§5).
 */
class PacketaProviderService extends AbstractFulfillmentProviderService {
  static identifier = "packeta"

  async getFulfillmentOptions(): Promise<any[]> {
    return []
  }
}

export default PacketaProviderService
