import { defineConfig } from "@medusajs/framework/utils"

// Fixture app config for @medusajs/test-utils' medusaIntegrationTestRunner
// (create-invoice-idempotency.test.ts). This is NOT a real backend -- it exists
// solely to give the runner a `cwd` with a medusa-config.{js,ts} it can load, so
// it boots Order + Payment (Medusa's own core modules, no explicit `modules:`
// needed -- see mente-eshop/apps/backend/medusa-config.ts, which doesn't list
// them either) against a real Postgres.
//
// `@medusa-cz/invoicing-abraflexi` itself is deliberately NOT registered here
// via `plugins:` the way the real backend does it: @medusajs/test-utils'
// plugin-discovery path doesn't reliably resolve/register a plugin's own
// modules for DI in this version (medusajs/medusa#11863, closed as
// "not planned"). Since AbraFlexiModuleService has zero DB models of its own,
// the test instead constructs it directly and registers it into the container
// by hand via the runner's `hooks.beforeServerStart` -- see the test file.
//
// `databaseUrl` below is a placeholder: @medusajs/test-utils' configLoaderOverride
// unconditionally overwrites projectConfig.databaseUrl with its own per-test
// database before the app boots (medusa-test-runner-utils/config.js).
module.exports = defineConfig({
  projectConfig: {
    databaseUrl: "postgres://placeholder/placeholder",
    http: {
      storeCors: "http://localhost:8000",
      adminCors: "http://localhost:7001",
      authCors: "http://localhost:7001",
      jwtSecret: "test-secret",
      cookieSecret: "test-secret",
    },
  },
})
