import { describe, it, expect, vi, beforeEach } from "vitest"

const createPacket = vi.fn()
vi.mock("../../../core/packeta-client", () => ({
  PacketaError: class extends Error {},
  PacketaClient: vi.fn().mockImplementation(() => ({ createPacket })),
}))
const validatePoint = vi.hoisted(() => vi.fn())
vi.mock("../../../core/widget-validate", () => ({ validatePoint }))

import PacketaProviderService from "../service"
import type { PacketaOptions } from "../../../types"

const options: PacketaOptions = {
  apiKey: "KEY",
  apiPassword: "PW",
  defaultCurrency: "CZK",
  priceTable: { cz: { bands: [{ maxWeight: 5, price: 89 }] } },
  homeDelivery: { priceTable: { cz: { bands: [{ maxWeight: 5, price: 129 }] } } },
  eveningDelivery: {
    priceTable: { cz: { bands: [{ maxWeight: 5, price: 179 }] } },
    carriers: [
      { carrierId: "18928", zipPrefixes: ["1"] },
      { carrierId: "26637", zipPrefixes: ["60", "61", "62"] },
    ],
  },
}

const provider = (opts: PacketaOptions = options) =>
  new PacketaProviderService({} as Record<string, unknown>, opts)

const HOME = { id: "packeta-home" }
const EVENING = { id: "packeta-evening" }
const PICKUP = { id: "packeta-pickup" }

const cart = (address: Record<string, unknown>) => ({
  email: "jana@example.cz",
  shipping_address: {
    country_code: "cz",
    first_name: "Jana",
    last_name: "Nováková",
    address_1: "Vinohradská 1234/56",
    city: "Praha",
    postal_code: "120 00",
    phone: "+420777123456",
    ...address,
  },
  items: [{ variant: { weight: 0.45 }, quantity: 1 }],
})

beforeEach(() => vi.clearAllMocks())

describe("fulfillment options", () => {
  it("offers home and evening delivery next to the pickup point when configured", async () => {
    expect(await provider().getFulfillmentOptions()).toEqual([
      { id: "packeta-pickup", name: "Packeta pickup point" },
      { id: "packeta-home", name: "Packeta home delivery" },
      { id: "packeta-evening", name: "Packeta evening delivery" },
    ])
  })

  it("offers only the pickup point without home/evening config", async () => {
    const { homeDelivery: _h, eveningDelivery: _e, ...pickupOnly } = options
    expect(await provider(pickupOnly).getFulfillmentOptions()).toEqual([
      { id: "packeta-pickup", name: "Packeta pickup point" },
    ])
  })
})

describe("prices per delivery type", () => {
  it("uses each option's own price table", async () => {
    const price = async (optionData: Record<string, unknown>) =>
      (await provider().calculatePrice(optionData as never, {} as never, cart({}) as never))
        .calculated_amount
    expect(await price(PICKUP)).toBe(89)
    expect(await price(HOME)).toBe(129)
    expect(await price(EVENING)).toBe(179)
    // Options created before home delivery existed carry no id: they are the pickup point.
    expect(await price({})).toBe(89)
  })
})

describe("adding a door option to the cart", () => {
  // Door options carry no shipping-method data, and Medusa then passes data undefined (live 500).
  it("prices it when Medusa passes no method data", async () => {
    const res = await provider().calculatePrice(HOME as never, undefined as never, cart({}) as never)
    expect(res.calculated_amount).toBe(129)
  })
})

describe("validateFulfillmentData for delivery to the door", () => {
  it("accepts a complete Czech address without a pickup point", async () => {
    const data = await provider().validateFulfillmentData(HOME as never, {} as never, cart({}) as never)
    expect(data).toEqual({ delivery: "home", carrier_id: "106" })
    expect(validatePoint).not.toHaveBeenCalled()
  })

  it("needs a phone number (Packeta's courier calls or texts)", async () => {
    await expect(
      provider().validateFulfillmentData(HOME as never, {} as never, cart({ phone: "" }) as never)
    ).rejects.toMatchObject({ type: "invalid_data", message: expect.stringMatching(/phone/) })
  })

  it("needs a street with a house number and a 5-digit postcode", async () => {
    await expect(
      provider().validateFulfillmentData(HOME as never, {} as never, cart({ address_1: "Vinohradská" }) as never)
    ).rejects.toMatchObject({ type: "invalid_data", message: expect.stringMatching(/house number/) })
    await expect(
      provider().validateFulfillmentData(HOME as never, {} as never, cart({ postal_code: "1200" }) as never)
    ).rejects.toMatchObject({ type: "invalid_data", message: expect.stringMatching(/postcode/) })
  })

  it("picks the evening carrier of the customer's city by postcode", async () => {
    const praha = await provider().validateFulfillmentData(EVENING as never, {} as never, cart({}) as never)
    expect(praha).toEqual({ delivery: "evening", carrier_id: "18928" })
    const brno = await provider().validateFulfillmentData(
      EVENING as never,
      {} as never,
      cart({ city: "Brno", postal_code: "602 00" }) as never
    )
    expect(brno).toEqual({ delivery: "evening", carrier_id: "26637" })
  })

  it("refuses evening delivery outside the covered cities", async () => {
    await expect(
      provider().validateFulfillmentData(
        EVENING as never,
        {} as never,
        cart({ city: "Kolín", postal_code: "280 02" }) as never
      )
    ).rejects.toMatchObject({
      type: "invalid_data",
      message: expect.stringMatching(/evening delivery is not available for postcode 28002/),
    })
  })
})

describe("createFulfillment to the door", () => {
  const order = {
    display_id: 21,
    email: "jana@example.cz",
    item_total: 2690,
    shipping_address: cart({}).shipping_address,
    items: [],
  }

  it("sends the address and the home-delivery carrier to Packeta", async () => {
    createPacket.mockResolvedValue({ id: "1", barcode: "Z1" })
    await provider().createFulfillment(
      { delivery: "home", carrier_id: "106" },
      [{ variant: { weight: 0.45 }, quantity: 1 }] as never,
      order as never,
      {} as never
    )
    expect(createPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        addressId: "106",
        street: "Vinohradská",
        houseNumber: "1234/56",
        city: "Praha",
        zip: "12000",
        phone: "+420777123456",
        email: "jana@example.cz",
      })
    )
    expect(createPacket.mock.calls[0]?.[0]).not.toHaveProperty("carrierPickupPoint")
  })

  it("re-derives the evening carrier from the order's address", async () => {
    createPacket.mockResolvedValue({ id: "1", barcode: "Z1" })
    await provider().createFulfillment(
      { delivery: "evening", carrier_id: "18928" },
      [] as never,
      { ...order, shipping_address: { ...order.shipping_address, city: "Brno", postal_code: "61200" } } as never,
      {} as never
    )
    expect(createPacket).toHaveBeenCalledWith(expect.objectContaining({ addressId: "26637", zip: "61200" }))
  })
})
