import { describe, it, expect } from "vitest"
import { mapOrderToFullCreditNote, mapRefundToLumpSumCreditNote } from "../order-to-credit-note-mapper"
import { CZ_VAT_RATE_BASIC } from "../../types"
import type { OrderDTO } from "@medusajs/framework/types"

function baseOrder(overrides: Partial<OrderDTO> = {}): OrderDTO {
  return {
    id: "ord_123",
    email: "customer@example.com",
    currency_code: "czk",
    metadata: null,
    billing_address: {
      id: "addr_1",
      first_name: "Jan",
      last_name: "Novák",
      address_1: "Hlavní 1",
      city: "Praha",
      postal_code: "11000",
      country_code: "cz",
      created_at: new Date(),
      updated_at: new Date(),
    },
    items: [
      { id: "li_1", title: "Tričko", quantity: 2, unit_price: 299 },
      { id: "li_2", title: "Doprava", quantity: 1, unit_price: 79 },
    ],
    ...overrides,
  } as OrderDTO
}

describe("mapOrderToFullCreditNote", () => {
  it("negates every item line's quantity, keeping name/unitPrice unchanged", () => {
    const payload = mapOrderToFullCreditNote(baseOrder(), { vatPayer: false }, "ref_1")
    expect(payload.lines).toEqual([
      { name: "Tričko", quantity: -2, unitPrice: 299, vatRate: undefined },
      { name: "Doprava", quantity: -1, unitPrice: 79, vatRate: undefined },
    ])
  })

  it("negates shipping lines too", () => {
    const order = baseOrder({
      shipping_methods: [{ name: "Poštovné", amount: 79 }] as OrderDTO["shipping_methods"],
    })
    const payload = mapOrderToFullCreditNote(order, { vatPayer: false }, "ref_1")
    expect(payload.lines[2]).toEqual({
      name: "Poštovné",
      quantity: -1,
      unitPrice: 79,
      vatRate: undefined,
    })
  })

  it("sets the credit-note external code from the order id and refund id", () => {
    const payload = mapOrderToFullCreditNote(baseOrder(), { vatPayer: false }, "ref_1")
    expect(payload.externalCode).toBe("order-ord_123-credit-ref_1")
  })

  it("keeps the vatPayer gating identical to mapOrderToAbraFlexiInvoice", () => {
    const payload = mapOrderToFullCreditNote(baseOrder(), { vatPayer: true }, "ref_1")
    expect(payload.lines.every((l) => l.vatRate === CZ_VAT_RATE_BASIC)).toBe(true)
    expect(payload.vatPayer).toBe(true)
  })

  it("reuses the same customer/currency mapping as the original invoice", () => {
    const payload = mapOrderToFullCreditNote(baseOrder(), { vatPayer: false }, "ref_1")
    expect(payload.currency).toBe("CZK")
    expect(payload.customer).toMatchObject({ name: "Jan Novák", city: "Praha" })
  })
})

describe("mapRefundToLumpSumCreditNote", () => {
  it("produces a single line with quantity -1 and unitPrice equal to the refund amount", () => {
    const payload = mapRefundToLumpSumCreditNote(baseOrder(), { vatPayer: false }, {
      id: "ref_1",
      amount: 150,
    })
    expect(payload.lines).toEqual([
      { name: "Refund", quantity: -1, unitPrice: 150, vatRate: undefined },
    ])
  })

  it("incorporates the refund's note into the line name when present", () => {
    const payload = mapRefundToLumpSumCreditNote(baseOrder(), { vatPayer: false }, {
      id: "ref_1",
      amount: 150,
      note: "Damaged item",
    })
    expect(payload.lines[0]!.name).toBe("Refund: Damaged item")
  })

  it("sets the credit-note external code from the order id and refund id", () => {
    const payload = mapRefundToLumpSumCreditNote(baseOrder(), { vatPayer: false }, {
      id: "ref_1",
      amount: 150,
    })
    expect(payload.externalCode).toBe("order-ord_123-credit-ref_1")
  })

  it("applies the basic VAT rate to the lump-sum line when vatPayer is true", () => {
    const payload = mapRefundToLumpSumCreditNote(baseOrder(), { vatPayer: true }, {
      id: "ref_1",
      amount: 150,
    })
    expect(payload.lines[0]!.vatRate).toBe(CZ_VAT_RATE_BASIC)
  })

  it("reuses the same customer/currency mapping as the original invoice", () => {
    const payload = mapRefundToLumpSumCreditNote(baseOrder(), { vatPayer: false }, {
      id: "ref_1",
      amount: 150,
    })
    expect(payload.currency).toBe("CZK")
    expect(payload.customer).toMatchObject({ name: "Jan Novák" })
  })
})
