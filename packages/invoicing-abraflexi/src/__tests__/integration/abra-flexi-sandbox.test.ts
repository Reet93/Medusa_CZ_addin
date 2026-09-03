import { describe, it, expect } from "vitest"
import { AbraFlexiClient } from "../../core/abra-flexi-client"

const baseUrl = process.env.ABRA_FLEXI_BASE_URL
const company = process.env.ABRA_FLEXI_COMPANY
const username = process.env.ABRA_FLEXI_USERNAME
const password = process.env.ABRA_FLEXI_PASSWORD
const run = baseUrl && company && username && password ? describe : describe.skip

run("Abra Flexi sandbox (live)", () => {
  it("creates a test invoice and returns its id/code", async () => {
    const client = new AbraFlexiClient({
      baseUrl: baseUrl!,
      company: company!,
      username: username!,
      password: password!,
    })

    const result = await client.createInvoice({
      externalCode: `sandbox-test-${Date.now()}`,
      currency: "CZK",
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      customer: { name: "Sandbox Test Customer", countryCode: "CZ" },
      lines: [{ name: "Integration test item", quantity: 1, unitPrice: 1 }],
      vatPayer: false,
    })
    expect(result.id).toBeTruthy()
    expect(result.code).toMatch(/^sandbox-test-/)
  })
})
