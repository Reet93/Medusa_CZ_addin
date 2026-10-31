import { describe, it, expect, vi } from "vitest"
import {
  assertInvoiceExistsStepFn,
  recordPaymentStepFn,
  persistRecordedPaymentIdStepFn,
} from "../record-payment-in-abra-flexi"
import { AbraFlexiApiError } from "../../core/abra-flexi-client"
import type { OrderDTO } from "@medusajs/framework/types"

const order = {
  id: "ord_1",
  email: "c@example.com",
  currency_code: "czk",
  metadata: {},
} as unknown as OrderDTO

function mockContainer(overrides: Record<string, unknown> = {}) {
  const query = {
    graph: vi.fn().mockResolvedValue({
      data: [
        {
          id: "ord_1",
          total: 1000,
          currency_code: "czk",
          payment_collections: [
            {
              payments: [
                {
                  id: "pay_1",
                  currency_code: "czk",
                  captures: [{ id: "cap_1", amount: 1000 }],
                  refunds: [],
                },
              ],
            },
          ],
        },
      ],
    }),
  }
  return { resolve: vi.fn((key: string) => ({ query, ...overrides })[key]) }
}

describe("assertInvoiceExistsStepFn", () => {
  it("resolves with the invoice id when order.metadata.abra_flexi_invoice_id is set", async () => {
    const orderWithInvoice = {
      ...order,
      metadata: { abra_flexi_invoice_id: "42" },
    } as OrderDTO

    const response = await assertInvoiceExistsStepFn({ order: orderWithInvoice }, {
      container: mockContainer(),
    } as never)

    expect(response.output).toEqual({ invoiceId: "42" })
  })

  it("fails permanently when order.metadata.abra_flexi_invoice_id is missing", async () => {
    await expect(
      assertInvoiceExistsStepFn({ order }, { container: mockContainer() } as never)
    ).rejects.toMatchObject({
      // Medusa's PermanentStepFailureError sets its own .name to "PermanentStepFailure".
      name: "PermanentStepFailure",
    })
  })
})

describe("recordPaymentStepFn", () => {
  it("calls the client with the given external code and returns its result", async () => {
    const client = { recordPayment: vi.fn().mockResolvedValue({ id: "99" }) }
    const container = mockContainer({ abraFlexi: { getClient: () => client } })

    const response = await recordPaymentStepFn({ externalCode: "order-ord_1", orderId: "ord_1" }, {
      container,
    } as never)

    expect(client.recordPayment).toHaveBeenCalledWith({ invoiceExternalCode: "order-ord_1" })
    expect(response.output).toEqual({ id: "99" })
  })

  it("rethrows a retryable AbraFlexiApiError so the workflow engine retries", async () => {
    const client = {
      recordPayment: vi.fn().mockRejectedValue(new AbraFlexiApiError(500, "boom", true)),
    }
    const container = mockContainer({ abraFlexi: { getClient: () => client } })

    await expect(
      recordPaymentStepFn({ externalCode: "order-ord_1", orderId: "ord_1" }, { container } as never)
    ).rejects.toMatchObject({ name: "AbraFlexiApiError", retryable: true })
  })

  it("converts a non-retryable AbraFlexiApiError into a permanent step failure", async () => {
    const client = {
      recordPayment: vi.fn().mockRejectedValue(new AbraFlexiApiError(400, "bad code", false)),
    }
    const container = mockContainer({ abraFlexi: { getClient: () => client } })

    await expect(
      recordPaymentStepFn({ externalCode: "order-ord_1", orderId: "ord_1" }, { container } as never)
    ).rejects.toMatchObject({
      // Medusa's PermanentStepFailureError sets its own .name to "PermanentStepFailure"
      // (no "Error" suffix) -- same as create-invoice-in-abra-flexi.test.ts's equivalent case.
      name: "PermanentStepFailure",
    })
  })
})

describe("persistRecordedPaymentIdStepFn", () => {
  it("appends the payment id to an empty recorded-ids list", async () => {
    const updateOrders = vi.fn().mockResolvedValue({})
    const container = mockContainer({ order: { updateOrders } })

    const response = await persistRecordedPaymentIdStepFn(
      { order, paymentId: "pay_1", recordedPaymentAbraFlexiId: "99" },
      { container } as never
    )

    expect(updateOrders).toHaveBeenCalledWith("ord_1", {
      metadata: { abra_flexi_recorded_payment_ids: ["pay_1"] },
    })
    expect(response.output).toEqual(["pay_1"])
  })

  it("appends to an existing list without dropping prior entries (split-tender)", async () => {
    const updateOrders = vi.fn().mockResolvedValue({})
    const container = mockContainer({ order: { updateOrders } })
    const orderWithExisting = {
      ...order,
      metadata: { abra_flexi_recorded_payment_ids: ["pay_0"] },
    } as OrderDTO

    const response = await persistRecordedPaymentIdStepFn(
      { order: orderWithExisting, paymentId: "pay_1", recordedPaymentAbraFlexiId: "100" },
      { container } as never
    )

    expect(updateOrders).toHaveBeenCalledWith("ord_1", {
      metadata: { abra_flexi_recorded_payment_ids: ["pay_0", "pay_1"] },
    })
    expect(response.output).toEqual(["pay_0", "pay_1"])
  })

  it("preserves unrelated metadata keys already set by invoice creation", async () => {
    const updateOrders = vi.fn().mockResolvedValue({})
    const container = mockContainer({ order: { updateOrders } })
    const orderWithInvoiceMetadata = {
      ...order,
      metadata: { abra_flexi_invoice_id: "42", abra_flexi_invoice_code: "order-ord_1" },
    } as OrderDTO

    await persistRecordedPaymentIdStepFn(
      { order: orderWithInvoiceMetadata, paymentId: "pay_1", recordedPaymentAbraFlexiId: "99" },
      { container } as never
    )

    expect(updateOrders).toHaveBeenCalledWith("ord_1", {
      metadata: {
        abra_flexi_invoice_id: "42",
        abra_flexi_invoice_code: "order-ord_1",
        abra_flexi_recorded_payment_ids: ["pay_1"],
      },
    })
  })
})

describe("payment coverage regression", () => {
  it("does not mark a 1000 CZK invoice paid after capturing only 400 CZK", async () => {
    const client = { recordPayment: vi.fn().mockResolvedValue({ id: "99" }) }
    const query = {
      graph: vi.fn().mockResolvedValue({
        data: [
          {
            id: "ord_partial",
            total: 1000,
            currency_code: "czk",
            payment_collections: [
              {
                payments: [
                  {
                    id: "pay_partial",
                    amount: 1000,
                    currency_code: "czk",
                    captured_at: null,
                    captures: [{ id: "cap_partial", amount: 400 }],
                    refunds: [],
                  },
                ],
              },
            ],
          },
        ],
      }),
    }
    const container = mockContainer({ abraFlexi: { getClient: () => client }, query })
    const response = await recordPaymentStepFn(
      {
        externalCode: "ext:medusa-order:ord_partial",
        orderId: "ord_partial",
      } as never,
      { container } as never
    )

    expect(response.output).toBeUndefined()
    expect(client.recordPayment).not.toHaveBeenCalled()
  })
})

describe("completed capture coverage", () => {
  const payment = (captures: Array<{ id: string; amount: unknown }>, overrides = {}) => ({
    id: "pay_1",
    currency_code: "czk",
    captures,
    refunds: [],
    ...overrides,
  })
  const cap = (id: string, amount: unknown) => ({ id, amount })

  it.each([
    {
      name: "an authorization without captures",
      total: 1000,
      payments: [payment([], { amount: 1000, captured_at: "2026-10-31" })],
      paid: false,
    },
    {
      name: "two captures completing the same payment",
      total: 1000,
      payments: [payment([cap("cap_1", 400), cap("cap_2", 600)])],
      paid: true,
    },
    {
      name: "two captured payment methods",
      total: 1000,
      payments: [payment([cap("cap_1", 400)]), payment([cap("cap_2", 600)], { id: "pay_2" })],
      paid: true,
    },
    {
      name: "a canceled attempt plus an insufficient payment",
      total: 1000,
      payments: [
        payment([cap("old", 1000)], { canceled_at: "2026-10-31" }),
        payment([cap("new", 400)], { id: "pay_2" }),
      ],
      paid: false,
    },
    {
      name: "refunded money plus an insufficient replacement",
      total: 1000,
      payments: [
        payment([cap("old", 1000)], { refunds: [{ id: "ref_1", amount: 1000 }] }),
        payment([cap("new", 400)], { id: "pay_2" }),
      ],
      paid: false,
    },
    {
      name: "a duplicated capture in graph results",
      total: 1000,
      payments: [payment([cap("same", 600), cap("same", 600)])],
      paid: false,
    },
    {
      name: "exact decimal captures",
      total: "0.3",
      payments: [payment([cap("a", "0.1"), cap("b", "0.2")])],
      paid: true,
    },
    { name: "an order with no payment collections", total: 1000, payments: [], paid: false },
  ])("handles $name", async ({ total, payments, paid }) => {
    const client = { recordPayment: vi.fn().mockResolvedValue({ id: "99" }) }
    const query = {
      graph: vi.fn().mockResolvedValue({
        data: [{ id: "ord_1", total, currency_code: "czk", payment_collections: [{ payments }] }],
      }),
    }
    const response = await recordPaymentStepFn(
      {
        externalCode: "ext:medusa-order:ord_1",
        orderId: "ord_1",
      } as never,
      { container: mockContainer({ abraFlexi: { getClient: () => client }, query }) } as never
    )
    expect(response.output).toEqual(paid ? { id: "99" } : undefined)
    expect(client.recordPayment).toHaveBeenCalledTimes(paid ? 1 : 0)
  })

  it.each([
    { total: undefined, currency_code: "czk", captures: [cap("cap_1", 1000)] },
    { total: "NaN", currency_code: "czk", captures: [cap("cap_1", 1000)] },
    { total: 1000, currency_code: "eur", captures: [cap("cap_1", 1000)] },
    { total: 1000, currency_code: "czk", captures: [cap("cap_1", -1000)] },
    { total: 1000, currency_code: "czk", captures: [cap("cap_1", null)] },
  ])(
    "fails closed on invalid or incompatible money: %j",
    async ({ total, currency_code, captures }) => {
      const client = { recordPayment: vi.fn().mockResolvedValue({ id: "99" }) }
      const query = {
        graph: vi.fn().mockResolvedValue({
          data: [
            {
              id: "ord_1",
              total,
              currency_code: "czk",
              payment_collections: [{ payments: [payment(captures, { currency_code })] }],
            },
          ],
        }),
      }
      await expect(
        recordPaymentStepFn(
          {
            externalCode: "ext:medusa-order:ord_1",
            orderId: "ord_1",
          } as never,
          { container: mockContainer({ abraFlexi: { getClient: () => client }, query }) } as never
        )
      ).rejects.toMatchObject({ name: "PermanentStepFailure" })
      expect(client.recordPayment).not.toHaveBeenCalled()
    }
  )
})
