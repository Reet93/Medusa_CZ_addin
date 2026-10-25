import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../workflows/create-invoice-in-abra-flexi", () => ({
  createInvoiceInAbraFlexiWorkflow: vi.fn(),
}))
vi.mock("../../workflows/record-payment-in-abra-flexi", () => ({
  recordPaymentInAbraFlexiWorkflow: vi.fn(),
}))

import abraFlexiOrderPlacedHandler, { config } from "../order-placed"
import { createInvoiceInAbraFlexiWorkflow } from "../../workflows/create-invoice-in-abra-flexi"
import { recordPaymentInAbraFlexiWorkflow } from "../../workflows/record-payment-in-abra-flexi"

type Payment = {
  id: string
  captured_at: string | null
  canceled_at?: string | null
  amount?: number
  refunds?: Array<{ amount: number }>
}

function containerWithPayments(collections: Payment[][]) {
  const graph = vi.fn().mockResolvedValue({
    data: [{ id: "ord_1", payment_collections: collections.map((payments) => ({ payments })) }],
  })
  return { container: { resolve: vi.fn().mockReturnValue({ graph }) } as never, graph }
}

describe("order-placed subscriber", () => {
  let createRun: ReturnType<typeof vi.fn>
  let recordRun: ReturnType<typeof vi.fn>
  const calls: string[] = []

  beforeEach(() => {
    calls.length = 0
    createRun = vi.fn().mockImplementation(async ({ input }) => {
      calls.push(`invoice:${input.paymentId}`)
      return { result: { id: "1", code: "order-ord_1" } }
    })
    recordRun = vi.fn().mockImplementation(async ({ input }) => {
      calls.push(`record:${input.paymentId}`)
      return { result: { recordedPaymentIds: [input.paymentId] } }
    })
    ;(createInvoiceInAbraFlexiWorkflow as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      run: createRun,
    })
    ;(recordPaymentInAbraFlexiWorkflow as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      run: recordRun,
    })
  })

  it("listens on order.placed", () => {
    expect(config.event).toBe("order.placed")
  })

  // Auto-capture (e.g. Comgate capture: "automatic") captures inside cart
  // completion, where Medusa's payment module never emits payment.captured --
  // so the order would otherwise never be invoiced.
  it("invoices and records each payment that is already captured when the order is placed", async () => {
    const { container, graph } = containerWithPayments([
      [{ id: "pay_1", captured_at: "2026-10-25T13:33:21.624Z" }],
    ])

    await abraFlexiOrderPlacedHandler({
      event: { data: { id: "ord_1" }, name: "order.placed" },
      container,
      pluginOptions: {},
    } as never)

    expect(graph).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "order", filters: { id: "ord_1" } })
    )
    expect(calls).toEqual(["invoice:pay_1", "record:pay_1"])
  })

  it("skips payments that are only authorized (payment.captured handles them later)", async () => {
    const { container } = containerWithPayments([[{ id: "pay_1", captured_at: null }]])

    await abraFlexiOrderPlacedHandler({
      event: { data: { id: "ord_1" }, name: "order.placed" },
      container,
      pluginOptions: {},
    } as never)

    expect(createRun).not.toHaveBeenCalled()
    expect(recordRun).not.toHaveBeenCalled()
  })

  it("handles several captured payments across collections, in order", async () => {
    const { container } = containerWithPayments([
      [
        { id: "pay_1", captured_at: "2026-10-25T13:33:21Z" },
        { id: "pay_2", captured_at: null },
      ],
      [{ id: "pay_3", captured_at: "2026-10-25T13:34:00Z" }],
    ])

    await abraFlexiOrderPlacedHandler({
      event: { data: { id: "ord_1" }, name: "order.placed" },
      container,
      pluginOptions: {},
    } as never)

    expect(calls).toEqual(["invoice:pay_1", "record:pay_1", "invoice:pay_3", "record:pay_3"])
  })

  // A cart whose first completion failed keeps its captured-then-refunded payment in the
  // same collection; the order is placed with a second payment (live test, 2026-10-25).
  it("skips captured payments that were fully refunded or canceled", async () => {
    const { container } = containerWithPayments([
      [
        {
          id: "pay_refunded",
          captured_at: "2026-10-25T18:04:11Z",
          amount: 2690,
          refunds: [{ amount: 2690 }],
        },
        {
          id: "pay_canceled",
          captured_at: "2026-10-25T18:05:00Z",
          canceled_at: "2026-10-25T18:06:00Z",
        },
        {
          id: "pay_partial",
          captured_at: "2026-10-25T19:00:00Z",
          amount: 2690,
          refunds: [{ amount: 500 }],
        },
        { id: "pay_live", captured_at: "2026-10-25T19:11:08Z", amount: 2690, refunds: [] },
      ],
    ])

    await abraFlexiOrderPlacedHandler({
      event: { data: { id: "ord_1" }, name: "order.placed" },
      container,
      pluginOptions: {},
    } as never)

    expect(calls).toEqual([
      "invoice:pay_partial",
      "record:pay_partial",
      "invoice:pay_live",
      "record:pay_live",
    ])
  })

  it("does not record a payment when its invoice creation fails", async () => {
    createRun.mockRejectedValueOnce(new Error("invoice creation failed"))
    const { container } = containerWithPayments([
      [{ id: "pay_1", captured_at: "2026-10-25T13:33:21Z" }],
    ])

    await expect(
      abraFlexiOrderPlacedHandler({
        event: { data: { id: "ord_1" }, name: "order.placed" },
        container,
        pluginOptions: {},
      } as never)
    ).rejects.toThrow("invoice creation failed")

    expect(recordRun).not.toHaveBeenCalled()
  })
})
