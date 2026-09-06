import { describe, it, expect, afterAll } from "vitest"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { asValue } from "@medusajs/framework/awilix"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework"
import { createInvoiceInAbraFlexiWorkflow } from "../../../workflows/create-invoice-in-abra-flexi.js"
import { ABRA_FLEXI_MODULE } from "../../../modules/abra-flexi/index.js"
import AbraFlexiModuleService from "../../../modules/abra-flexi/service.js"
import { startMockAbraFlexiServer, type MockAbraFlexiServer } from "./mock-abra-flexi-server.js"

// The headline acceptance criterion this repo shipped without coverage for
// (local.md, "Abra Flexi idempotency-guard test coverage"): the
// create-invoice-in-abra-flexi workflow must not double-invoice an order when
// its payment.captured subscriber fires twice for the same payment (event
// redelivery, or a retried step). The unit tests in
// ../../workflows/__tests__/create-invoice-in-abra-flexi.test.ts already cover
// each step function in isolation with a mocked container -- what they can't
// catch is whether the guard's `order.metadata.abra_flexi_invoice_id` check
// actually survives a real round trip through Postgres between the two runs
// (a mock always returns whatever the test tells it to). Hence a real DB.
//
// Requires a reachable Postgres with CREATEDB rights (it creates and drops its
// own throwaway database -- never point this at a shared/production DB).
// Also requires `pg-god` as an explicit devDependency of this package: it's
// what @medusajs/test-utils' dist/database.js actually calls to create/drop
// that database, but test-utils 2.17.0 doesn't declare it as its own
// dependency (require("pg-god") fails otherwise -- an upstream packaging gap,
// not something to "fix" by removing the pg-god devDependency here).
// Skipped unless DB_HOST is set, since @medusajs/test-utils captures
// DB_HOST/DB_USERNAME/DB_PASSWORD/DB_PORT at module-load time (medusajs/medusa
// #16272), so they must be real process env vars before vitest starts, e.g.:
//
//   DB_HOST=localhost DB_USERNAME=medusa DB_PASSWORD=*** DB_PORT=5432 \
//     pnpm test:integration
//
// Use the literal string "localhost", not "127.0.0.1": test-utils'
// configLoaderOverride does `clientUrl.includes("localhost")` to decide
// whether to force `ssl: { rejectUnauthorized: false }` into
// databaseDriverOptions. 127.0.0.1 takes that SSL branch against a plain
// non-TLS local Postgres, which doesn't error but hangs the connection pool
// indefinitely instead (verified against the server's Postgres container).
//
// Note: the runner's own cleanup does not reliably DROP its throwaway
// database on exit (only disconnects) -- verified across several runs against
// the server's Postgres. It's harmless (a new random `medusa-<ulid>-
// integration-1` name each run, never the real app's database), but drop it
// by hand occasionally: `docker exec medusa-postgres-1 psql -U medusa -d
// postgres -c 'DROP DATABASE "medusa-<ulid>-integration-1"'`.
const hasDb = !!process.env.DB_HOST
const run = hasDb ? medusaIntegrationTestRunner : skippedSuite

let mock: MockAbraFlexiServer

run({
  cwd: __dirname,
  hooks: {
    // AbraFlexiModuleService has no DB models of its own, so it's safe to
    // construct directly and register into the real container by hand
    // instead of going through `plugins:` in ./medusa-config.ts -- see that
    // file's comment for why.
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
    describe("Abra Flexi idempotency guard (DB-backed)", () => {
      afterAll(async () => {
        await mock.close()
      })

      it("does not create a second invoice when the workflow runs twice for the same payment", async () => {
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

        // Same link @medusajs/core-flows' createOrderPaymentCollectionWorkflow
        // creates -- this is what makes resolveOrderStepFn's
        // `query.graph({ entity: "order_payment_collection", ... })` resolve.
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

        // First delivery of payment.captured -- creates the invoice.
        const first = await createInvoiceInAbraFlexiWorkflow(container).run({
          input: { paymentId: payment.id },
        })

        // Duplicate delivery of the same event (at-least-once redelivery, or a
        // retried subscriber) -- must reuse the persisted invoice id, not call
        // Abra Flexi again.
        const second = await createInvoiceInAbraFlexiWorkflow(container).run({
          input: { paymentId: payment.id },
        })

        expect(mock.callCount()).toBe(1)
        expect(second.result).toEqual(first.result)
      })
    })
  },
})

function skippedSuite() {
  describe.skip("Abra Flexi idempotency guard (DB-backed) -- skipped, DB_HOST not set", () => {
    it("requires DB_HOST/DB_USERNAME/DB_PASSWORD/DB_PORT env vars pointing at a real Postgres", () => {})
  })
}
