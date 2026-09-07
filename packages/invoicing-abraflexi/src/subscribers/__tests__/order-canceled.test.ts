import { describe, it, expect, vi } from "vitest"

vi.mock("../../workflows/create-credit-note-in-abra-flexi", () => ({
  createCreditNoteInAbraFlexiWorkflow: vi.fn(),
}))

import abraFlexiOrderCanceledHandler, { config } from "../order-canceled"
import { createCreditNoteInAbraFlexiWorkflow } from "../../workflows/create-credit-note-in-abra-flexi"

describe("order-canceled subscriber", () => {
  it("listens on order.canceled", () => {
    expect(config.event).toBe("order.canceled")
  })

  it("runs the credit-note workflow with the event's order id and triggeredBy: order_canceled", async () => {
    const run = vi.fn().mockResolvedValue({ result: { recordedRefundIds: ["ref_1", "ref_2"] } })
    ;(createCreditNoteInAbraFlexiWorkflow as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      run,
    })
    const container = {} as never

    await abraFlexiOrderCanceledHandler({
      event: { data: { id: "ord_1" }, name: "order.canceled" },
      container,
      pluginOptions: {},
    } as never)

    expect(createCreditNoteInAbraFlexiWorkflow).toHaveBeenCalledWith(container)
    expect(run).toHaveBeenCalledWith({
      input: { orderId: "ord_1", triggeredBy: "order_canceled" },
    })
  })
})
