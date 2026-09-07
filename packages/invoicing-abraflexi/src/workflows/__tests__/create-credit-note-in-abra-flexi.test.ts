import { describe, it, expect, vi } from "vitest"
import {
  resolveOrderByIdStepFn,
  listNewRefundsStepFn,
  createCreditNotesForNewRefundsStepFn,
  persistRecordedRefundIdsStepFn,
} from "../create-credit-note-in-abra-flexi"
import { AbraFlexiApiError } from "../../core/abra-flexi-client"
import type { OrderDTO, RefundDTO } from "@medusajs/framework/types"

const order = {
  id: "ord_1",
  email: "c@example.com",
  currency_code: "czk",
  metadata: { abra_flexi_invoice_id: "42", abra_flexi_invoice_code: "order-ord_1" },
  billing_address: { first_name: "Jan", last_name: "Novák" },
  items: [{ id: "li_1", title: "Tričko", quantity: 1, unit_price: 100 }],
} as unknown as OrderDTO

function mockContainer(overrides: Record<string, unknown> = {}) {
  return { resolve: vi.fn((key: string) => overrides[key]) }
}

function refund(overrides: Partial<RefundDTO> = {}): RefundDTO {
  return {
    id: "ref_1",
    amount: 100,
    created_at: new Date("2026-09-01"),
    note: null,
    ...overrides,
  } as unknown as RefundDTO
}

describe("resolveOrderByIdStepFn", () => {
  it("resolves the order and flattens payment ids across every payment collection", async () => {
    const query = {
      graph: vi.fn().mockResolvedValue({
        data: [
          {
            ...order,
            payment_collections: [{ payments: [{ id: "pay_1" }, { id: "pay_2" }] }],
          },
        ],
      }),
    }
    const container = mockContainer({ query })

    const response = await resolveOrderByIdStepFn(
      { orderId: "ord_1", triggeredBy: "order_canceled" },
      { container } as never
    )

    expect(query.graph).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "order", filters: { id: "ord_1" } })
    )
    expect(response.output.paymentIds).toEqual(["pay_1", "pay_2"])
  })

  it("throws when no order is found for the id", async () => {
    const query = { graph: vi.fn().mockResolvedValue({ data: [] }) }
    const container = mockContainer({ query })

    await expect(
      resolveOrderByIdStepFn({ orderId: "ord_missing", triggeredBy: "order_canceled" }, {
        container,
      } as never)
    ).rejects.toThrow(/no order found/)
  })

  it("returns an empty payment id list when the order has no payment collections", async () => {
    const query = {
      graph: vi.fn().mockResolvedValue({ data: [{ ...order, payment_collections: [] }] }),
    }
    const container = mockContainer({ query })

    const response = await resolveOrderByIdStepFn(
      { orderId: "ord_1", triggeredBy: "order_canceled" },
      { container } as never
    )

    expect(response.output.paymentIds).toEqual([])
  })
})

describe("listNewRefundsStepFn", () => {
  it("returns an empty array without calling listRefunds when there are no payment ids", async () => {
    const listRefunds = vi.fn()
    const container = mockContainer({ payment: { listRefunds } })

    const response = await listNewRefundsStepFn({ paymentIds: [], recordedRefundIds: [] }, {
      container,
    } as never)

    expect(listRefunds).not.toHaveBeenCalled()
    expect(response.output).toEqual([])
  })

  it("filters out refund ids already recorded", async () => {
    const listRefunds = vi
      .fn()
      .mockResolvedValue([refund({ id: "ref_1" }), refund({ id: "ref_2" })])
    const container = mockContainer({ payment: { listRefunds } })

    const response = await listNewRefundsStepFn(
      { paymentIds: ["pay_1"], recordedRefundIds: ["ref_1"] },
      { container } as never
    )

    expect(response.output.map((r) => r.id)).toEqual(["ref_2"])
  })

  it("sorts remaining refunds oldest-first", async () => {
    const listRefunds = vi
      .fn()
      .mockResolvedValue([
        refund({ id: "ref_new", created_at: new Date("2026-09-05") }),
        refund({ id: "ref_old", created_at: new Date("2026-09-01") }),
      ])
    const container = mockContainer({ payment: { listRefunds } })

    const response = await listNewRefundsStepFn({ paymentIds: ["pay_1"], recordedRefundIds: [] }, {
      container,
    } as never)

    expect(response.output.map((r) => r.id)).toEqual(["ref_old", "ref_new"])
  })
})

describe("createCreditNotesForNewRefundsStepFn", () => {
  it("does nothing and calls no API when there are no new refunds", async () => {
    const createCreditNote = vi.fn()
    const container = mockContainer({
      abraFlexi: { getClient: () => ({ createCreditNote }), getOptions: () => ({}) },
    })

    const response = await createCreditNotesForNewRefundsStepFn(
      { order, newRefunds: [], triggeredBy: "order_canceled", invoiceExternalCode: "order-ord_1" },
      { container } as never
    )

    expect(createCreditNote).not.toHaveBeenCalled()
    expect(response.output).toEqual([])
  })

  it("builds a full-mirror payload for triggeredBy: order_canceled", async () => {
    const createCreditNote = vi
      .fn()
      .mockResolvedValue({ id: "1", code: "order-ord_1-credit-ref_1" })
    const container = mockContainer({
      abraFlexi: {
        getClient: () => ({ createCreditNote }),
        getOptions: () => ({ vatPayer: false }),
      },
    })

    await createCreditNotesForNewRefundsStepFn(
      {
        order,
        newRefunds: [refund({ id: "ref_1" })],
        triggeredBy: "order_canceled",
        invoiceExternalCode: "order-ord_1",
      },
      { container } as never
    )

    const sentPayload = createCreditNote.mock.calls[0]![0]
    expect(sentPayload.lines).toEqual([
      { name: "Tričko", quantity: -1, unitPrice: 100, vatRate: undefined },
    ])
    expect(sentPayload.originalInvoiceExternalCode).toBe("order-ord_1")
  })

  it("builds a lump-sum payload for triggeredBy: payment_refunded", async () => {
    const createCreditNote = vi
      .fn()
      .mockResolvedValue({ id: "1", code: "order-ord_1-credit-ref_1" })
    const container = mockContainer({
      abraFlexi: {
        getClient: () => ({ createCreditNote }),
        getOptions: () => ({ vatPayer: false }),
      },
    })

    await createCreditNotesForNewRefundsStepFn(
      {
        order,
        newRefunds: [refund({ id: "ref_1", amount: 250 })],
        triggeredBy: "payment_refunded",
        invoiceExternalCode: "order-ord_1",
      },
      { container } as never
    )

    const sentPayload = createCreditNote.mock.calls[0]![0]
    expect(sentPayload.lines).toEqual([
      { name: "Refund", quantity: -1, unitPrice: 250, vatRate: undefined },
    ])
  })

  it("creates one credit note per new refund, in the given order", async () => {
    const createCreditNote = vi
      .fn()
      .mockResolvedValueOnce({ id: "1", code: "order-ord_1-credit-ref_1" })
      .mockResolvedValueOnce({ id: "2", code: "order-ord_1-credit-ref_2" })
    const container = mockContainer({
      abraFlexi: {
        getClient: () => ({ createCreditNote }),
        getOptions: () => ({ vatPayer: false }),
      },
    })

    const response = await createCreditNotesForNewRefundsStepFn(
      {
        order,
        newRefunds: [refund({ id: "ref_1" }), refund({ id: "ref_2" })],
        triggeredBy: "payment_refunded",
        invoiceExternalCode: "order-ord_1",
      },
      { container } as never
    )

    expect(createCreditNote).toHaveBeenCalledTimes(2)
    expect(response.output).toEqual([
      { refundId: "ref_1", creditNoteId: "1", creditNoteCode: "order-ord_1-credit-ref_1" },
      { refundId: "ref_2", creditNoteId: "2", creditNoteCode: "order-ord_1-credit-ref_2" },
    ])
  })

  it("rethrows a retryable AbraFlexiApiError so the workflow engine retries", async () => {
    const createCreditNote = vi.fn().mockRejectedValue(new AbraFlexiApiError(500, "boom", true))
    const container = mockContainer({
      abraFlexi: {
        getClient: () => ({ createCreditNote }),
        getOptions: () => ({ vatPayer: false }),
      },
    })

    await expect(
      createCreditNotesForNewRefundsStepFn(
        {
          order,
          newRefunds: [refund({ id: "ref_1" })],
          triggeredBy: "payment_refunded",
          invoiceExternalCode: "order-ord_1",
        },
        { container } as never
      )
    ).rejects.toMatchObject({ name: "AbraFlexiApiError", retryable: true })
  })

  it("converts a non-retryable AbraFlexiApiError into a permanent step failure", async () => {
    const createCreditNote = vi
      .fn()
      .mockRejectedValue(new AbraFlexiApiError(400, "bad code", false))
    const container = mockContainer({
      abraFlexi: {
        getClient: () => ({ createCreditNote }),
        getOptions: () => ({ vatPayer: false }),
      },
    })

    await expect(
      createCreditNotesForNewRefundsStepFn(
        {
          order,
          newRefunds: [refund({ id: "ref_1" })],
          triggeredBy: "payment_refunded",
          invoiceExternalCode: "order-ord_1",
        },
        { container } as never
      )
    ).rejects.toMatchObject({
      // Medusa's PermanentStepFailureError sets its own .name to "PermanentStepFailure"
      // (no "Error" suffix) -- same as the other two workflows' equivalent cases.
      name: "PermanentStepFailure",
    })
  })
})

describe("persistRecordedRefundIdsStepFn", () => {
  it("does nothing and returns the existing list unchanged when there are no new refund ids", async () => {
    const updateOrders = vi.fn()
    const container = mockContainer({ order: { updateOrders } })
    const orderWithExisting = {
      ...order,
      metadata: { abra_flexi_recorded_refund_ids: ["ref_0"] },
    } as OrderDTO

    const response = await persistRecordedRefundIdsStepFn(
      { order: orderWithExisting, newRefundIds: [] },
      { container } as never
    )

    expect(updateOrders).not.toHaveBeenCalled()
    expect(response.output).toEqual(["ref_0"])
  })

  it("appends new refund ids to an empty list", async () => {
    const updateOrders = vi.fn().mockResolvedValue({})
    const container = mockContainer({ order: { updateOrders } })

    const response = await persistRecordedRefundIdsStepFn({ order, newRefundIds: ["ref_1"] }, {
      container,
    } as never)

    expect(updateOrders).toHaveBeenCalledWith("ord_1", {
      metadata: { ...order.metadata, abra_flexi_recorded_refund_ids: ["ref_1"] },
    })
    expect(response.output).toEqual(["ref_1"])
  })

  it("appends without dropping prior entries (a second, later refund on the same order)", async () => {
    const updateOrders = vi.fn().mockResolvedValue({})
    const container = mockContainer({ order: { updateOrders } })
    const orderWithExisting = {
      ...order,
      metadata: { abra_flexi_recorded_refund_ids: ["ref_1"] },
    } as OrderDTO

    const response = await persistRecordedRefundIdsStepFn(
      { order: orderWithExisting, newRefundIds: ["ref_2"] },
      { container } as never
    )

    expect(updateOrders).toHaveBeenCalledWith("ord_1", {
      metadata: { abra_flexi_recorded_refund_ids: ["ref_1", "ref_2"] },
    })
    expect(response.output).toEqual(["ref_1", "ref_2"])
  })
})
