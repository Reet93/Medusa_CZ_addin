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

describe("createFulfillment", () => {
  const order = {
    id: "order_1",
    display_id: 42,
    email: "jan@example.com",
    item_total: 500,
    shipping_address: { first_name: "Jan", last_name: "Novák", phone: "+420777123456" },
  }
  const items = [{ variant: { weight: 2 }, quantity: 1 }]

  it("internal point → createPacket with addressId = pickup_point_id; stores packet id+barcode", async () => {
    createPacket.mockResolvedValue({ id: "900719925474099", barcode: "Z900719925474099" })
    const data = { pickup_point_id: "79", pickup_point_type: "internal" }
    const res = await makeProvider().createFulfillment(
      data,
      items as never,
      order as never,
      {} as never
    )
    expect(createPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        number: "42",
        name: "Jan",
        surname: "Novák",
        email: "jan@example.com",
        addressId: "79",
        value: 500,
        weight: 2,
      })
    )
    expect(res.data).toMatchObject({ packet_id: "900719925474099", barcode: "Z900719925474099" })
    expect(res.labels).toEqual([])
  })

  it("external point → addressId = carrier_id and carrierPickupPoint set", async () => {
    createPacket.mockResolvedValue({ id: "1", barcode: "Z1" })
    const data = {
      pickup_point_id: "3060",
      pickup_point_type: "external",
      carrier_id: "3060",
      carrier_pickup_point_id: "ABC",
    }
    await makeProvider().createFulfillment(data, items as never, order as never, {} as never)
    expect(createPacket).toHaveBeenCalledWith(
      expect.objectContaining({ addressId: "3060", carrierPickupPoint: "ABC" })
    )
  })

  it("COD order → cod + currency set on the packet", async () => {
    createPacket.mockResolvedValue({ id: "1", barcode: "Z1" })
    const data = { pickup_point_id: "79", cod: true, cod_amount: 500 }
    await makeProvider().createFulfillment(data, items as never, order as never, {} as never)
    expect(createPacket).toHaveBeenCalledWith(
      expect.objectContaining({ cod: 500, currency: "CZK" })
    )
  })
})

describe("cancelFulfillment", () => {
  it("cancels the stored packet id", async () => {
    cancelPacket.mockResolvedValue(undefined)
    await makeProvider().cancelFulfillment({ packet_id: "900719925474099" })
    expect(cancelPacket).toHaveBeenCalledWith("900719925474099")
  })
})

describe("createReturnFulfillment", () => {
  it("creates a return packet claim and stores its id", async () => {
    createPacketClaim.mockResolvedValue({ id: "77", barcode: "Z77" })
    const res = await makeProvider().createReturnFulfillment({
      data: { packet_id: "900719925474099", pickup_point_id: "79" },
    } as never)
    expect(createPacketClaim).toHaveBeenCalled()
    expect(res.data).toMatchObject({ return_packet_id: "77", return_barcode: "Z77" })
  })
})

describe("label documents", () => {
  it("getShipmentDocuments returns the label PDF (base64) for the stored packet", async () => {
    packetLabelPdf.mockResolvedValue("JVBERi0xLjQK")
    const docs = await makeProvider().getShipmentDocuments({ packet_id: "1" })
    expect(packetLabelPdf).toHaveBeenCalledWith("1", "A6 on A4")
    expect(docs).toEqual([{ type: "label", base64: "JVBERi0xLjQK", mime: "application/pdf" }])
  })

  it("uses a configured labelFormat", async () => {
    packetLabelPdf.mockResolvedValue("X")
    await makeProvider({ ...options, labelFormat: "A7 on A4" }).getShipmentDocuments({
      packet_id: "1",
    })
    expect(packetLabelPdf).toHaveBeenCalledWith("1", "A7 on A4")
  })

  it("returns [] when there is no packet id", async () => {
    expect(await makeProvider().getShipmentDocuments({})).toEqual([])
  })
})
