import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    // Opt-in sandbox suite is excluded from the default (gate) run.
    exclude: ["**/node_modules/**", "src/__tests__/integration/**"],
  },
})
