import { describe, it, expect, afterAll } from "vitest"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { asValue } from "@medusajs/framework/awilix"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework"
import { createInvoiceInAbraFlexiWorkflow } from "../../../workflows/create-invoice-in-abra-flexi.js"
import { recordPaymentInAbraFlexiWorkflow } from "../../../workflows/record-payment-in-abra-flexi.js"
import { ABRA_FLEXI_MODULE } from "../../../modules/abra-flexi/index.js"
import AbraFlexiModuleService from "../../../modules/abra-flexi/service.js"
import { startMockAbraFlexiServer, type MockAbraFlexiServer } from "./mock-abra-flexi-server.js"

// Sibling to create-invoice-idempotency.test.ts's guard coverage -- proves
// recordPaymentInAbraFlexiWorkflow's own idempotency guard
// (order.metadata.abra_flexi_recorded_payment_ids) survives a real round trip
// through Postgres, same reasoning as that file's header comment (not repeated
// here -- same DB_HOST/pg-god/SSL requirements apply).
//
// The per-payment-id (not per-invoice) guard shape's split-tender behavior --
// recording a *different* payment id on the same order is NOT a no-op -- is
// covered at the unit level instead
// (record-payment-in-abra-flexi.test.ts's persistRecordedPaymentIdStepFn
// "appends to an existing list without dropping prior entries" case). Exercising
// that here would need a second real Medusa payment session/capture on the same
// payment collection, whose exact API shape for a split/zero-amount session
// isn't verified in this codebase -- not worth guessing at in a DB-backed test
// when the unit test already proves the guard's array-membership logic directly.
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
    describe("Abra Flexi record-payment idempotency guard (DB-backed)", () => {
      afterAll(async () => {
        await mock.close()
      })

      it("does not record a second payment when the workflow runs twice for the same payment id", async () => {
        const container = getContainer()
        const orderModuleService = container.resolve(Modules.ORDER)
        const paymentModuleService = container.resolve(Modules.PAYMENT)
        const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)

        const order = await orderModuleService.createOrders({
          email: "zakaznik@example.cz",
          currency_code: "czk",
          items: [{ title: "Tričko", quantity: 1, unit_price: 100 }],
          billing_address: { first_name: "Jan", last_name: "Novák" },
        })

        const paymentCollection = await paymentModuleService.createPaymentCollections({
          currency_code: "czk",
          amount: 100,
        })

        await remoteLink.create({
          [Modules.ORDER]: { order_id: order.id },
          [Modules.PAYMENT]: { payment_collection_id: paymentCollection.id },
        })

        const session = await paymentModuleService.createPaymentSession(paymentCollection.id, {
          provider_id: "pp_system_default",
          currency_code: "czk",
          amount: 100,
          data: {},
        })
        const payment = await paymentModuleService.authorizePaymentSession(session.id, {})
        await paymentModuleService.capturePayment({ payment_id: payment.id })

        await createInvoiceInAbraFlexiWorkflow(container).run({
          input: { paymentId: payment.id },
        })

        const first = await recordPaymentInAbraFlexiWorkflow(container).run({
          input: { paymentId: payment.id },
        })
        const second = await recordPaymentInAbraFlexiWorkflow(container).run({
          input: { paymentId: payment.id },
        })

        expect(mock.paymentRecordCallCount()).toBe(1)
        expect(second.result).toEqual(first.result)
      })
    })
  },
})

function skippedSuite() {
  describe.skip(
    "Abra Flexi record-payment idempotency guard (DB-backed) -- skipped, DB_HOST not set",
    () => {
      it("requires DB_HOST/DB_USERNAME/DB_PASSWORD/DB_PORT env vars pointing at a real Postgres", () => {})
    }
  )
}
