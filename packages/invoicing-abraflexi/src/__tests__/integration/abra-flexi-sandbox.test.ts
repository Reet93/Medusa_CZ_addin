import { describe, it, expect } from "vitest"
import { AbraFlexiClient } from "../../core/abra-flexi-client"
import { ABRA_FLEXI_PAYMENT_STATUS_CODE_PAID_MANUALLY } from "../../types"

const baseUrl = process.env.ABRA_FLEXI_BASE_URL
const company = process.env.ABRA_FLEXI_COMPANY
const username = process.env.ABRA_FLEXI_USERNAME
const password = process.env.ABRA_FLEXI_PASSWORD
const run = baseUrl && company && username && password ? describe : describe.skip

// Reads the invoice's own `stavUhrK` back via a plain GET -- not through
// AbraFlexiClient, which has no read method (out of this plan's scope; adding
// one is a client-shape decision for whichever sub-project needs it next).
// Added after review: asserting only that recordPayment() resolves with a
// truthy id proves Abra Flexi accepted *a* write, not that it actually applied
// the paid-manually status -- an upsert-shaped PUT would return a result id
// either way. This is the one check in the whole plan that can tell "the
// stavUhrK field write worked" from "Abra Flexi silently ignored/misapplied it".
async function fetchStavUhrK(externalCode: string): Promise<string | undefined> {
  const auth = "Basic " + Buffer.from(`${username}:${password}`).toString("base64")
  const res = await fetch(
    `${baseUrl}/c/${company}/faktura-vydana/code:${encodeURIComponent(externalCode)}.json?detail=full`,
    { headers: { Authorization: auth } }
  )
  const body = (await res.json()) as {
    winstrom?: { "faktura-vydana"?: { stavUhrK?: string }[] }
  }
  return body.winstrom?.["faktura-vydana"]?.[0]?.stavUhrK
}

// Reads the credit note's own `dobropisovanyDokl` field back via a plain GET
// -- the real assertion for "did the link PUT actually take", not just that
// Abra Flexi accepted two separate writes (an unlinked credit note and a
// no-op link call would both return a truthy id either way). Field name per
// docs/superpowers/research/2026-09-07-abra-flexi-credit-notes-api-verification.md
// Part 1's XML example -- unchanged in JSON, same as this file's existing
// fetchStavUhrK helper does for stavUhrK.
async function fetchDobropisovanyDokl(externalCode: string): Promise<string | undefined> {
  const auth = "Basic " + Buffer.from(`${username}:${password}`).toString("base64")
  const res = await fetch(
    `${baseUrl}/c/${company}/faktura-vydana/code:${encodeURIComponent(externalCode)}.json?detail=full`,
    { headers: { Authorization: auth } }
  )
  const body = (await res.json()) as {
    winstrom?: { "faktura-vydana"?: { dobropisovanyDokl?: string }[] }
  }
  return body.winstrom?.["faktura-vydana"]?.[0]?.dobropisovanyDokl
}

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

  it("records a payment against a just-created invoice", async () => {
    const client = new AbraFlexiClient({
      baseUrl: baseUrl!,
      company: company!,
      username: username!,
      password: password!,
    })

    const externalCode = `sandbox-test-payment-${Date.now()}`
    await client.createInvoice({
      externalCode,
      currency: "CZK",
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      customer: { name: "Sandbox Test Customer", countryCode: "CZ" },
      lines: [{ name: "Integration test item", quantity: 1, unitPrice: 1 }],
      vatPayer: false,
    })

    const result = await client.recordPayment({ invoiceExternalCode: externalCode })
    expect(result.id).toBeTruthy()

    // The real assertion: confirm the invoice's stavUhrK was actually set to the
    // paid-manually code, not just that Abra Flexi accepted some write against it.
    const stavUhrK = await fetchStavUhrK(externalCode)
    expect(stavUhrK).toBe(`code:${ABRA_FLEXI_PAYMENT_STATUS_CODE_PAID_MANUALLY}`)
  })

  it("creates a credit note and links it to a just-created invoice", async () => {
    const client = new AbraFlexiClient({
      baseUrl: baseUrl!,
      company: company!,
      username: username!,
      password: password!,
    })

    const invoiceExternalCode = `sandbox-test-invoice-for-credit-${Date.now()}`
    await client.createInvoice({
      externalCode: invoiceExternalCode,
      currency: "CZK",
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      customer: { name: "Sandbox Test Customer", countryCode: "CZ" },
      lines: [{ name: "Integration test item", quantity: 1, unitPrice: 100 }],
      vatPayer: false,
    })

    const creditNoteExternalCode = `sandbox-test-credit-${Date.now()}`
    const result = await client.createCreditNote({
      externalCode: creditNoteExternalCode,
      originalInvoiceExternalCode: invoiceExternalCode,
      currency: "CZK",
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      customer: { name: "Sandbox Test Customer", countryCode: "CZ" },
      lines: [{ name: "Refund", quantity: -1, unitPrice: 100 }],
      vatPayer: false,
    })

    expect(result.id).toBeTruthy()
    expect(result.code).toBe(creditNoteExternalCode)

    const linkedTo = await fetchDobropisovanyDokl(creditNoteExternalCode)
    expect(linkedTo).toContain(invoiceExternalCode)
  })
})
