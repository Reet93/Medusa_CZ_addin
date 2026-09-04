import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    // Opt-in sandbox suite is excluded from the default (gate) run.
    // .medusa/** holds `medusa plugin:build`'s compiled output, including copies of
    // every *.test.ts as *.test.js — without this exclude, vitest picks those up too
    // and double-counts the whole suite once the package has been built (same latent
    // gap found and fixed in invoicing-abraflexi's Task 4, backported here).
    exclude: ["**/node_modules/**", "src/__tests__/integration/**", ".medusa/**"],
  },
})
