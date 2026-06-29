import { describe, it, expect } from "vitest"
import { calculateShippingPrice } from "../pricing"
import type { PriceTable } from "../../types"

const table: PriceTable = {
  cz: {
    bands: [
      { maxWeight: 5, price: 79 },
      { maxWeight: 10, price: 99 },
    ],
    codSurcharge: 30,
    freeOver: 1500,
  },
}

describe("calculateShippingPrice", () => {
  it("picks the band by weight (inclusive upper bound)", () => {
    expect(calculateShippingPrice(table, "cz", 3, {})).toBe(79)
    expect(calculateShippingPrice(table, "cz", 5, {})).toBe(79)
    expect(calculateShippingPrice(table, "cz", 7, {})).toBe(99)
  })

  it("falls back to the heaviest band when over the top bound", () => {
    expect(calculateShippingPrice(table, "cz", 50, {})).toBe(99)
  })

  it("adds the COD surcharge when cod=true", () => {
    expect(calculateShippingPrice(table, "cz", 3, { cod: true })).toBe(109)
  })

  it("is free when subtotal ≥ freeOver (even with COD)", () => {
    expect(calculateShippingPrice(table, "cz", 3, { cod: true, subtotal: 1500 })).toBe(0)
  })

  it("is case-insensitive on country", () => {
    expect(calculateShippingPrice(table, "CZ", 3, {})).toBe(79)
  })

  it("throws for an unconfigured country", () => {
    expect(() => calculateShippingPrice(table, "de", 3, {})).toThrow(/no packeta price/i)
  })
})
