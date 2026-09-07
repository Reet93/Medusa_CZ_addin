import { describe, it, expect, vi } from "vitest"

vi.mock("../../workflows/create-invoice-in-abra-flexi", () => ({
  createInvoiceInAbraFlexiWorkflow: vi.fn(),
}))
vi.mock("../../workflows/record-payment-in-abra-flexi", () => ({
  recordPaymentInAbraFlexiWorkflow: vi.fn(),
}))

import abraFlexiPaymentCapturedHandler, { config } from "../payment-captured"
import { createInvoiceInAbraFlexiWorkflow } from "../../workflows/create-invoice-in-abra-flexi"
import { recordPaymentInAbraFlexiWorkflow } from "../../workflows/record-payment-in-abra-flexi"

describe("payment-captured subscriber", () => {
  it("listens on payment.captured", () => {
    expect(config.event).toBe("payment.captured")
  })

  it("runs createInvoiceInAbraFlexiWorkflow then recordPaymentInAbraFlexiWorkflow with the payment id", async () => {
    const createRun = vi.fn().mockResolvedValue({ result: { id: "1", code: "order-ord_1" } })
    ;(createInvoiceInAbraFlexiWorkflow as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      run: createRun,
    })
    const recordRun = vi.fn().mockResolvedValue({ result: { recordedPaymentIds: ["pay_1"] } })
    ;(recordPaymentInAbraFlexiWorkflow as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      run: recordRun,
    })
    const container = {} as never

    await abraFlexiPaymentCapturedHandler({
      event: { data: { id: "pay_1" }, name: "payment.captured" },
      container,
      pluginOptions: {},
    } as never)

    expect(createInvoiceInAbraFlexiWorkflow).toHaveBeenCalledWith(container)
    expect(createRun).toHaveBeenCalledWith({ input: { paymentId: "pay_1" } })
    expect(recordPaymentInAbraFlexiWorkflow).toHaveBeenCalledWith(container)
    expect(recordRun).toHaveBeenCalledWith({ input: { paymentId: "pay_1" } })
  })

  it("does not run recordPaymentInAbraFlexiWorkflow when invoice creation fails", async () => {
    const createRun = vi.fn().mockRejectedValue(new Error("invoice creation failed"))
    ;(createInvoiceInAbraFlexiWorkflow as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      run: createRun,
    })
    const recordRun = vi.fn()
    ;(recordPaymentInAbraFlexiWorkflow as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      run: recordRun,
    })
    const container = {} as never

    await expect(
      abraFlexiPaymentCapturedHandler({
        event: { data: { id: "pay_1" }, name: "payment.captured" },
        container,
        pluginOptions: {},
      } as never)
    ).rejects.toThrow("invoice creation failed")

    expect(recordRun).not.toHaveBeenCalled()
  })
})
