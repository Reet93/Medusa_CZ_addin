import { describe, it, expect, vi } from "vitest"
import {
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
  return { resolve: vi.fn((key: string) => overrides[key]) }
}

describe("recordPaymentStepFn", () => {
  it("calls the client with the given external code and returns its result", async () => {
    const client = { recordPayment: vi.fn().mockResolvedValue({ id: "99" }) }
    const container = mockContainer({ abraFlexi: { getClient: () => client } })

    const response = await recordPaymentStepFn({ externalCode: "order-ord_1" }, {
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
      recordPaymentStepFn({ externalCode: "order-ord_1" }, { container } as never)
    ).rejects.toMatchObject({ name: "AbraFlexiApiError", retryable: true })
  })

  it("converts a non-retryable AbraFlexiApiError into a permanent step failure", async () => {
    const client = {
      recordPayment: vi.fn().mockRejectedValue(new AbraFlexiApiError(400, "bad code", false)),
    }
    const container = mockContainer({ abraFlexi: { getClient: () => client } })

    await expect(
      recordPaymentStepFn({ externalCode: "order-ord_1" }, { container } as never)
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
})
