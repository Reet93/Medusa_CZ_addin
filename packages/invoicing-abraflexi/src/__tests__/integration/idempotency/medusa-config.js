// Fixture app config for @medusajs/test-utils' medusaIntegrationTestRunner
// (create-invoice-idempotency.test.ts). This is NOT a real backend -- it exists
// solely to give the runner a `cwd` with a medusa-config it can load, so it
// boots Order + Payment (Medusa's own core modules, no explicit `modules:`
// needed -- see mente-eshop/apps/backend/medusa-config.ts, which doesn't list
// them either) against a real Postgres.
//
// Plain .js, not .ts: @medusajs/test-utils' configLoaderOverride loads this
// file with a raw Node require/dynamic import (no ts-node/swc-register hook
// in that path, unlike vitest's own module graph), so a .ts sibling here
// fails with "Cannot find module .../medusa-config" -- verified against the
// server's real Postgres while building this suite.
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
// Plain CJS require, matched to configLoaderOverride's raw Node require of
// this file (see comment above).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { defineConfig } = require("@medusajs/framework/utils")

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
