import { describe, it, expect } from "vitest"
import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils"
import PacketaProviderService from "../../providers/packeta/service"
import type { PacketaOptions } from "../../types"

// Mirrors comgate's integration check: prove the built provider is
// registrable under Medusa's fulfillment module and its options resolve.
// No network — @medusajs/test-utils' AbstractFulfillmentProviderService is
// the same base class the provider extends at runtime.
describe("Packeta provider registration", () => {
  const options: PacketaOptions = {
    apiKey: "KEY",
    apiPassword: "PW",
    priceTable: { cz: { bands: [{ maxWeight: 5, price: 79 }] } },
  }

  it("has the static identifier `packeta`", () => {
    expect(PacketaProviderService.identifier).toBe("packeta")
  })

  it("constructs and lists the configured fulfillment option", async () => {
    const provider = new PacketaProviderService({} as Record<string, unknown>, options)
    const opts = await provider.getFulfillmentOptions()
    expect(opts[0]).toMatchObject({ id: "packeta-pickup", name: "Packeta pickup point" })
  })

  it("is recognized by Medusa as a fulfillment service", () => {
    const provider = new PacketaProviderService({} as Record<string, unknown>, options)
    expect(AbstractFulfillmentProviderService.isFulfillmentService(provider)).toBe(true)
  })
})
