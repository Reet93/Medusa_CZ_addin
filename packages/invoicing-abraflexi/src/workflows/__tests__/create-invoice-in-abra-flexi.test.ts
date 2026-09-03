import { describe, it, expect, vi } from "vitest"
import {
  resolveOrderStepFn,
  mapOrderToPayloadStepFn,
  createInvoiceStepFn,
  persistInvoiceIdStepFn,
} from "../create-invoice-in-abra-flexi"
import { AbraFlexiApiError } from "../../core/abra-flexi-client"
import type { OrderDTO } from "@medusajs/framework/types"

const order = {
  id: "ord_1",
  email: "c@example.com",
  currency_code: "czk",
  metadata: {},
  billing_address: { first_name: "Jan", last_name: "Novák" },
  items: [{ id: "li_1", title: "Tričko", quantity: 1, unit_price: 100 }],
} as unknown as OrderDTO

function mockContainer(overrides: Record<string, unknown> = {}) {
  return { resolve: vi.fn((key: string) => overrides[key]) }
}

describe("resolveOrderStepFn", () => {
  it("resolves the order via the payment's payment_collection_id", async () => {
    const payment = { id: "pay_1", payment_collection_id: "pay_col_1" }
    const paymentModuleService = { retrievePayment: vi.fn().mockResolvedValue(payment) }
    const query = { graph: vi.fn().mockResolvedValue({ data: [{ order }] }) }
    const container = mockContainer({ payment: paymentModuleService, query })

    const response = await resolveOrderStepFn({ paymentId: "pay_1" }, { container } as never)

    expect(paymentModuleService.retrievePayment).toHaveBeenCalledWith("pay_1")
    expect(query.graph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "order_payment_collection",
        filters: { payment_collection_id: "pay_col_1" },
      })
    )
    expect(response.output).toEqual({ order })
  })

  it("throws (no retry) when the payment has no linked order", async () => {
    const paymentModuleService = {
      retrievePayment: vi.fn().mockResolvedValue({ id: "pay_1", payment_collection_id: "pay_col_1" }),
    }
    const query = { graph: vi.fn().mockResolvedValue({ data: [] }) }
    const container = mockContainer({ payment: paymentModuleService, query })

    await expect(resolveOrderStepFn({ paymentId: "pay_1" }, { container } as never)).rejects.toThrow(
      /no order found/
    )
  })
})

describe("mapOrderToPayloadStepFn", () => {
  it("maps the order using the module's configured vatPayer flag", async () => {
    const abraFlexiModule = { getOptions: () => ({ vatPayer: true }) }
    const container = mockContainer({ abraFlexi: abraFlexiModule })

    const response = await mapOrderToPayloadStepFn({ order }, { container } as never)

    expect(response.output.vatPayer).toBe(true)
    expect(response.output.externalCode).toBe("order-ord_1")
  })
})

describe("createInvoiceStepFn", () => {
  const payload = {
    externalCode: "order-ord_1",
    currency: "CZK",
    issueDate: "2026-09-03",
    dueDate: "2026-09-17",
    customer: { name: "Jan Novák" },
    lines: [{ name: "Tričko", quantity: 1, unitPrice: 100 }],
    vatPayer: false,
  }

  it("returns the created invoice on success", async () => {
    const client = { createInvoice: vi.fn().mockResolvedValue({ id: "1", code: "order-ord_1" }) }
    const abraFlexiModule = { getClient: () => client }
    const container = mockContainer({ abraFlexi: abraFlexiModule })

    const response = await createInvoiceStepFn(payload, { container } as never)

    expect(response.output).toEqual({ id: "1", code: "order-ord_1" })
  })

  it("rethrows a retryable AbraFlexiApiError so the workflow engine retries", async () => {
    const client = {
      createInvoice: vi.fn().mockRejectedValue(new AbraFlexiApiError(500, "boom", true)),
    }
    const container = mockContainer({ abraFlexi: { getClient: () => client } })

    await expect(createInvoiceStepFn(payload, { container } as never)).rejects.toMatchObject({
      name: "AbraFlexiApiError",
      retryable: true,
    })
  })

  it("converts a non-retryable AbraFlexiApiError into a permanent step failure", async () => {
    const client = {
      createInvoice: vi.fn().mockRejectedValue(new AbraFlexiApiError(400, "bad payload", false)),
    }
    const container = mockContainer({ abraFlexi: { getClient: () => client } })

    await expect(createInvoiceStepFn(payload, { container } as never)).rejects.toMatchObject({
      // Medusa's PermanentStepFailureError sets its own .name to "PermanentStepFailure"
      // (no "Error" suffix) — verified in @medusajs/orchestration's errors.js.
      name: "PermanentStepFailure",
    })
  })
})

describe("persistInvoiceIdStepFn", () => {
  it("merges the invoice id/code into existing order metadata", async () => {
    const updateOrders = vi.fn().mockResolvedValue({})
    const container = mockContainer({ order: { updateOrders } })
    const orderWithMetadata = { ...order, metadata: { existing: "keep-me" } } as OrderDTO

    await persistInvoiceIdStepFn(
      { order: orderWithMetadata, invoice: { id: "1", code: "order-ord_1" } },
      { container } as never
    )

    expect(updateOrders).toHaveBeenCalledWith("ord_1", {
      metadata: { existing: "keep-me", abra_flexi_invoice_id: "1", abra_flexi_invoice_code: "order-ord_1" },
    })
  })
})
