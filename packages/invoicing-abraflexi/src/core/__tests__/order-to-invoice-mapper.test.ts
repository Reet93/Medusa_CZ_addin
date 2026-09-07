import { describe, it, expect } from "vitest"
import {
  mapOrderToAbraFlexiInvoice,
  abraFlexiExternalCodeForOrder,
  creditNoteExternalCodeForRefund,
} from "../order-to-invoice-mapper"
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

describe("mapOrderToAbraFlexiInvoice", () => {
  it("maps line items, currency, and issue/due dates", () => {
    const payload = mapOrderToAbraFlexiInvoice(baseOrder(), { vatPayer: false })
    expect(payload.currency).toBe("CZK")
    expect(payload.lines).toEqual([
      { name: "Tričko", quantity: 2, unitPrice: 299, vatRate: undefined },
      { name: "Doprava", quantity: 1, unitPrice: 79, vatRate: undefined },
    ])
    expect(payload.issueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(payload.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(new Date(payload.dueDate).getTime()).toBeGreaterThan(
      new Date(payload.issueDate).getTime()
    )
  })

  it("uses order id as the deterministic external code", () => {
    const payload = mapOrderToAbraFlexiInvoice(baseOrder({ id: "ord_456" }), { vatPayer: false })
    expect(payload.externalCode).toBe("order-ord_456")
  })

  it("maps the billing address into the customer, upper-casing the country code", () => {
    const payload = mapOrderToAbraFlexiInvoice(baseOrder(), { vatPayer: false })
    expect(payload.customer).toMatchObject({
      name: "Jan Novák",
      street: "Hlavní 1",
      city: "Praha",
      postalCode: "11000",
      countryCode: "CZ",
    })
  })

  it("falls back to the shipping address when billing address is missing", () => {
    const order = baseOrder({
      billing_address: undefined,
      shipping_address: {
        id: "addr_2",
        first_name: "Petra",
        last_name: "Svobodová",
        address_1: "Vedlejší 2",
        city: "Brno",
        postal_code: "60200",
        country_code: "cz",
        created_at: new Date(),
        updated_at: new Date(),
      },
    })
    const payload = mapOrderToAbraFlexiInvoice(order, { vatPayer: false })
    expect(payload.customer.name).toBe("Petra Svobodová")
    expect(payload.customer.city).toBe("Brno")
  })

  it("falls back to the order email when no address name is available", () => {
    const order = baseOrder({
      billing_address: undefined,
      shipping_address: undefined,
    })
    const payload = mapOrderToAbraFlexiInvoice(order, { vatPayer: false })
    expect(payload.customer.name).toBe("customer@example.com")
  })

  it("omits vatRate on every line when vatPayer is false", () => {
    const payload = mapOrderToAbraFlexiInvoice(baseOrder(), { vatPayer: false })
    expect(payload.lines.every((l) => l.vatRate === undefined)).toBe(true)
    expect(payload.vatPayer).toBe(false)
  })

  it("sets CZ_VAT_RATE_BASIC on every line when vatPayer is true", () => {
    const payload = mapOrderToAbraFlexiInvoice(baseOrder(), { vatPayer: true })
    expect(payload.lines.every((l) => l.vatRate === CZ_VAT_RATE_BASIC)).toBe(true)
    expect(payload.vatPayer).toBe(true)
  })

  it("appends a line for each shipping method, after the item lines", () => {
    const order = baseOrder({
      shipping_methods: [{ name: "Doprava", amount: 79 }] as OrderDTO["shipping_methods"],
    })
    const payload = mapOrderToAbraFlexiInvoice(order, { vatPayer: false })
    expect(payload.lines).toEqual([
      { name: "Tričko", quantity: 2, unitPrice: 299, vatRate: undefined },
      { name: "Doprava", quantity: 1, unitPrice: 79, vatRate: undefined },
      { name: "Doprava", quantity: 1, unitPrice: 79, vatRate: undefined },
    ])
  })

  it("sets CZ_VAT_RATE_BASIC on shipping lines too when vatPayer is true", () => {
    const order = baseOrder({
      shipping_methods: [{ name: "Poštovné", amount: 79 }] as OrderDTO["shipping_methods"],
    })
    const payload = mapOrderToAbraFlexiInvoice(order, { vatPayer: true })
    expect(payload.lines).toHaveLength(3)
    expect(payload.lines[2]).toEqual({
      name: "Poštovné",
      quantity: 1,
      unitPrice: 79,
      vatRate: CZ_VAT_RATE_BASIC,
    })
  })

  it("maps cleanly with no phantom line when shipping_methods is undefined", () => {
    const payload = mapOrderToAbraFlexiInvoice(baseOrder({ shipping_methods: undefined }), {
      vatPayer: false,
    })
    expect(payload.lines).toEqual([
      { name: "Tričko", quantity: 2, unitPrice: 299, vatRate: undefined },
      { name: "Doprava", quantity: 1, unitPrice: 79, vatRate: undefined },
    ])
  })

  it("includes a valid IČO from order metadata", () => {
    const order = baseOrder({ metadata: { ico: "25063677" } })
    const payload = mapOrderToAbraFlexiInvoice(order, { vatPayer: false })
    expect(payload.customer.ico).toBe("25063677")
  })

  it("omits an invalid IČO instead of blocking mapping", () => {
    const order = baseOrder({ metadata: { ico: "00000000" } })
    const payload = mapOrderToAbraFlexiInvoice(order, { vatPayer: false })
    expect(payload.customer.ico).toBeUndefined()
  })

  it("includes DIČ only alongside a valid IČO", () => {
    const withBoth = mapOrderToAbraFlexiInvoice(
      baseOrder({ metadata: { ico: "25063677", dic: "CZ25063677" } }),
      { vatPayer: false }
    )
    expect(withBoth.customer.dic).toBe("CZ25063677")

    const dicOnly = mapOrderToAbraFlexiInvoice(baseOrder({ metadata: { dic: "CZ25063677" } }), {
      vatPayer: false,
    })
    expect(dicOnly.customer.dic).toBeUndefined()
    expect(dicOnly.customer.ico).toBeUndefined()
  })

  it("omits ico/dic entirely when order has no metadata", () => {
    const payload = mapOrderToAbraFlexiInvoice(baseOrder({ metadata: null }), { vatPayer: false })
    expect(payload.customer.ico).toBeUndefined()
    expect(payload.customer.dic).toBeUndefined()
  })
})

describe("abraFlexiExternalCodeForOrder", () => {
  it("prefixes the order id with 'order-'", () => {
    expect(abraFlexiExternalCodeForOrder("ord_123")).toBe("order-ord_123")
  })
})

describe("creditNoteExternalCodeForRefund", () => {
  it("combines the order id and refund id into a single deterministic code", () => {
    expect(creditNoteExternalCodeForRefund("ord_123", "ref_1")).toBe("order-ord_123-credit-ref_1")
  })
})
