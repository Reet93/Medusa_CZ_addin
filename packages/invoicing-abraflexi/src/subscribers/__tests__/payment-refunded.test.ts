import { describe, it, expect, vi } from "vitest"

vi.mock("../../workflows/create-invoice-in-abra-flexi", () => ({
  resolveOrderStepFn: vi.fn(),
}))
vi.mock("../../workflows/create-credit-note-in-abra-flexi", () => ({
  createCreditNoteInAbraFlexiWorkflow: vi.fn(),
}))

import abraFlexiPaymentRefundedHandler, { config } from "../payment-refunded"
import { resolveOrderStepFn } from "../../workflows/create-invoice-in-abra-flexi"
import { createCreditNoteInAbraFlexiWorkflow } from "../../workflows/create-credit-note-in-abra-flexi"

describe("payment-refunded subscriber", () => {
  it("listens on payment.refunded", () => {
    expect(config.event).toBe("payment.refunded")
  })

  it("resolves the order from the payment id and runs the credit-note workflow with triggeredBy: payment_refunded", async () => {
    ;(resolveOrderStepFn as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: { order: { id: "ord_1" } },
    })
    const run = vi.fn().mockResolvedValue({ result: { recordedRefundIds: ["ref_1"] } })
    ;(createCreditNoteInAbraFlexiWorkflow as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      run,
    })
    const container = {} as never

    await abraFlexiPaymentRefundedHandler({
      event: { data: { id: "pay_1" }, name: "payment.refunded" },
      container,
      pluginOptions: {},
    } as never)

    expect(resolveOrderStepFn).toHaveBeenCalledWith({ paymentId: "pay_1" }, { container })
    expect(createCreditNoteInAbraFlexiWorkflow).toHaveBeenCalledWith(container)
    expect(run).toHaveBeenCalledWith({
      input: { orderId: "ord_1", triggeredBy: "payment_refunded" },
    })
  })
})
