import { describe, it, expect, afterAll } from "vitest"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { asValue } from "@medusajs/framework/awilix"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework"
import { createInvoiceInAbraFlexiWorkflow } from "../../../workflows/create-invoice-in-abra-flexi.js"
import { createCreditNoteInAbraFlexiWorkflow } from "../../../workflows/create-credit-note-in-abra-flexi.js"
import { ABRA_FLEXI_MODULE } from "../../../modules/abra-flexi/index.js"
import AbraFlexiModuleService from "../../../modules/abra-flexi/service.js"
import { startMockAbraFlexiServer, type MockAbraFlexiServer } from "./mock-abra-flexi-server.js"

// Sibling to create-invoice-idempotency.test.ts / record-payment-idempotency.test.ts's
// guard coverage -- proves createCreditNoteInAbraFlexiWorkflow's own
// idempotency guard (order.metadata.abra_flexi_recorded_refund_ids) survives
// a real round trip through Postgres, same DB_HOST/pg-god/SSL requirements as
// those files (not repeated here).
//
// Exercises *two* refunds on the same order, per the design spec's explicit
// acceptance requirement ("at least two refunds on one order, proving the
// second one isn't dropped") -- a single-refund test could pass even with a
// per-order (not per-refund-id) guard bug that a real multi-refund business
// case would hit.
const hasDb = !!process.env.DB_HOST
const run = hasDb ? medusaIntegrationTestRunner : skippedSuite

let mock: MockAbraFlexiServer

run({
  cwd: __dirname,
  hooks: {
    beforeServerStart: async (container: MedusaContainer) => {
      mock = await startMockAbraFlexiServer()
      container.register({
        [ABRA_FLEXI_MODULE]: asValue(
          new AbraFlexiModuleService(
            {},
            {
              baseUrl: mock.baseUrl,
              company: "1",
              username: "test",
              password: "test",
              vatPayer: false,
            }
          )
        ),
      })
    },
  },
  testSuite: ({ getContainer }) => {
    describe("Abra Flexi credit-note idempotency guard (DB-backed)", () => {
      afterAll(async () => {
        await mock.close()
      })

      it("creates one credit note per new refund, never re-creates one already recorded", async () => {
        const container = getContainer()
        const orderModuleService = container.resolve(Modules.ORDER)
        const paymentModuleService = container.resolve(Modules.PAYMENT)
        const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)

        const order = await orderModuleService.createOrders({
          email: "zakaznik@example.cz",
          currency_code: "czk",
          items: [{ title: "Tričko", quantity: 1, unit_price: 300 }],
          billing_address: { first_name: "Jan", last_name: "Novák" },
        })

        const paymentCollection = await paymentModuleService.createPaymentCollections({
          currency_code: "czk",
          amount: 300,
        })

        await remoteLink.create({
          [Modules.ORDER]: { order_id: order.id },
          [Modules.PAYMENT]: { payment_collection_id: paymentCollection.id },
        })

        const session = await paymentModuleService.createPaymentSession(paymentCollection.id, {
          provider_id: "pp_system_default",
          currency_code: "czk",
          amount: 300,
          data: {},
        })
        const payment = await paymentModuleService.authorizePaymentSession(session.id, {})
        await paymentModuleService.capturePayment({ payment_id: payment.id })

        await createInvoiceInAbraFlexiWorkflow(container).run({
          input: { paymentId: payment.id },
        })

        // First refund.
        await paymentModuleService.refundPayment({ payment_id: payment.id, amount: 100 })

        const firstRun = await createCreditNoteInAbraFlexiWorkflow(container).run({
          input: { orderId: order.id, triggeredBy: "payment_refunded" },
        })
        expect(mock.creditNoteCreateCallCount()).toBe(1)
        expect(mock.creditNoteLinkCallCount()).toBe(1)
        expect(firstRun.result.recordedRefundIds).toHaveLength(1)

        // Re-running with no new refunds must be a no-op.
        const secondRun = await createCreditNoteInAbraFlexiWorkflow(container).run({
          input: { orderId: order.id, triggeredBy: "payment_refunded" },
        })
        expect(mock.creditNoteCreateCallCount()).toBe(1)
        expect(mock.creditNoteLinkCallCount()).toBe(1)
        expect(secondRun.result.recordedRefundIds).toEqual(firstRun.result.recordedRefundIds)

        // A second, different refund on the same order/payment must NOT be
        // dropped -- the headline correctness property of per-refund-id (not
        // per-order, not per-payment) idempotency.
        await paymentModuleService.refundPayment({ payment_id: payment.id, amount: 50 })

        const thirdRun = await createCreditNoteInAbraFlexiWorkflow(container).run({
          input: { orderId: order.id, triggeredBy: "payment_refunded" },
        })
        expect(mock.creditNoteCreateCallCount()).toBe(2)
        expect(mock.creditNoteLinkCallCount()).toBe(2)
        expect(thirdRun.result.recordedRefundIds).toHaveLength(2)
      })
    })
  },
})

function skippedSuite() {
  describe.skip("Abra Flexi credit-note idempotency guard (DB-backed) -- skipped, DB_HOST not set", () => {
    it("requires DB_HOST/DB_USERNAME/DB_PASSWORD/DB_PORT env vars pointing at a real Postgres", () => {})
  })
}
