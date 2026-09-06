import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    // @medusajs/test-utils' medusaIntegrationTestRunner (used by the DB-backed
    // idempotency integration test) calls describe/beforeAll/beforeEach/
    // afterEach/afterAll as bare globals internally, Jest-style, without
    // importing them -- globals:true is required for that file to load at
    // all. Every other test file keeps its existing explicit `import { ... }
    // from "vitest"` style; vitest allows both at once.
    globals: true,
    // The opt-in live suite is excluded from the default (gate) run.
    // .medusa/** holds `medusa plugin:build`'s compiled output, including copies of
    // every *.test.ts as *.test.js — without this exclude, vitest picks those up too
    // and double-counts the whole suite once the package has been built (same latent
    // gap flagged in fulfillment-packeta's M2a plan, Task 11, "handle at Task 14 gate").
    exclude: ["**/node_modules/**", "src/__tests__/integration/**", ".medusa/**"],
  },
})
