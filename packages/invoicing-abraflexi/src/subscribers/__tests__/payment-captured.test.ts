import { describe, it, expect, vi } from "vitest"

vi.mock("../../workflows/create-invoice-in-abra-flexi", () => ({
  createInvoiceInAbraFlexiWorkflow: vi.fn(),
}))

import abraFlexiPaymentCapturedHandler, { config } from "../payment-captured"
import { createInvoiceInAbraFlexiWorkflow } from "../../workflows/create-invoice-in-abra-flexi"

describe("payment-captured subscriber", () => {
  it("listens on payment.captured", () => {
    expect(config.event).toBe("payment.captured")
  })

  it("runs createInvoiceInAbraFlexiWorkflow with the payment id from the event", async () => {
    const run = vi.fn().mockResolvedValue({ result: { id: "1", code: "order-ord_1" } })
    ;(createInvoiceInAbraFlexiWorkflow as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ run })
    const container = {} as never

    await abraFlexiPaymentCapturedHandler({
      event: { data: { id: "pay_1" }, name: "payment.captured" },
      container,
      pluginOptions: {},
    } as never)

    expect(createInvoiceInAbraFlexiWorkflow).toHaveBeenCalledWith(container)
    expect(run).toHaveBeenCalledWith({ input: { paymentId: "pay_1" } })
  })
})
