import { describe, it, expect, vi, beforeEach } from "vitest"

const createPacket = vi.fn()
const cancelPacket = vi.fn()
const packetLabelPdf = vi.fn()
const createPacketClaim = vi.fn()
vi.mock("../../../core/packeta-client", () => ({
  PacketaError: class extends Error {},
  PacketaClient: vi.fn().mockImplementation(() => ({
    createPacket,
    cancelPacket,
    packetLabelPdf,
    createPacketClaim,
  })),
}))
const validatePoint = vi.fn()
vi.mock("../../../core/widget-validate", () => ({ validatePoint }))

import PacketaProviderService from "../service"
import type { PacketaOptions } from "../../../types"

const options: PacketaOptions = {
  apiKey: "KEY",
  apiPassword: "PW",
  defaultCurrency: "CZK",
  priceTable: { cz: { bands: [{ maxWeight: 5, price: 79 }], codSurcharge: 30, freeOver: 1500 } },
}

function makeProvider(opts: PacketaOptions = options) {
  return new PacketaProviderService({} as Record<string, unknown>, opts)
}

beforeEach(() => vi.clearAllMocks())

describe("validateOptions", () => {
  it("throws when apiKey or apiPassword is missing", () => {
    expect(() => PacketaProviderService.validateOptions({ apiKey: "x" })).toThrow(/apiPassword/i)
    expect(() => PacketaProviderService.validateOptions({ apiPassword: "x" })).toThrow(/apiKey/i)
  })
})

describe("getFulfillmentOptions", () => {
  it("returns one option from config (id + name)", async () => {
    const opts = await makeProvider().getFulfillmentOptions()
    expect(opts).toEqual([{ id: "packeta-pickup", name: "Packeta pickup point" }])
  })
})

describe("canCalculate / calculatePrice", () => {
  it("canCalculate is always true", async () => {
    expect(await makeProvider().canCalculate({} as never)).toBe(true)
  })

  it("calculatePrice prices by country×weight from context", async () => {
    const res = await makeProvider().calculatePrice(
      {} as never,
      { cod: false } as never,
      {
        shipping_address: { country_code: "cz" },
        items: [{ variant: { weight: 2 }, quantity: 2 }],
      } as never
    )
    // 2 items × 2kg = 4kg → 79
    expect(res).toMatchObject({ calculated_amount: 79, is_calculated_price_tax_inclusive: false })
  })

  it("calculatePrice adds COD surcharge when data.cod is set", async () => {
    const res = await makeProvider().calculatePrice(
      {} as never,
      { cod: true } as never,
      {
        shipping_address: { country_code: "cz" },
        items: [{ variant: { weight: 1 }, quantity: 1 }],
      } as never
    )
    expect(res).toMatchObject({ calculated_amount: 109 })
  })
})
