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
const validatePoint = vi.hoisted(() => vi.fn())
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

describe("validateFulfillmentData", () => {
  it("normalizes an internal point and persists it (server validation off)", async () => {
    const provider = makeProvider({ ...options, validatePointServerSide: false })
    const out = await provider.validateFulfillmentData(
      {},
      { pickup_point_id: "79", pickup_point_name: "Praha 1", pickup_point_type: "internal" },
      {}
    )
    expect(out).toMatchObject({ pickup_point_id: "79", pickup_point_type: "internal" })
    expect(validatePoint).not.toHaveBeenCalled()
  })

  it("maps an external point's carrier ids", async () => {
    const provider = makeProvider({ ...options, validatePointServerSide: false })
    const out = await provider.validateFulfillmentData(
      {},
      {
        pickup_point_id: "3060",
        pickup_point_type: "external",
        carrier_id: "3060",
        carrier_pickup_point_id: "ABC",
      },
      {}
    )
    expect(out).toMatchObject({
      pickup_point_type: "external",
      carrier_id: "3060",
      carrier_pickup_point_id: "ABC",
    })
  })

  it("throws when no pickup point is present", async () => {
    await expect(
      makeProvider({ ...options, validatePointServerSide: false }).validateFulfillmentData(
        {},
        {},
        {}
      )
    ).rejects.toThrow(/pickup point/i)
  })

  it("calls the validate endpoint when enabled and rejects an invalid point", async () => {
    validatePoint.mockResolvedValue({ isValid: false, errors: ["NotFound"] })
    await expect(
      makeProvider({ ...options, validatePointServerSide: true }).validateFulfillmentData(
        {},
        { pickup_point_id: "1" },
        {}
      )
    ).rejects.toThrow(/NotFound/)
    expect(validatePoint).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "KEY", point: { id: "1" } })
    )
  })
})
