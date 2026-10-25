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
    `${baseUrl}/c/${company}/faktura-vydana/(id = '${externalCode}').json?detail=full`,
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
//
// ABRA Flexi 2026.6.3 does not expose `dobropisovanyDokl` on read (checked live
// 2026-10-25); the link shows on the original invoice as `dobropisovano: "true"`
// and as a "Dobropis" entry in /vazby. So the read-back checks the invoice side.
async function fetchInvoiceDobropisovano(invoiceExternalCode: string): Promise<string | undefined> {
  const auth = "Basic " + Buffer.from(`${username}:${password}`).toString("base64")
  const res = await fetch(
    `${baseUrl}/c/${company}/faktura-vydana/(id = '${invoiceExternalCode}').json?detail=custom:dobropisovano`,
    { headers: { Authorization: auth } }
  )
  const body = (await res.json()) as {
    winstrom?: { "faktura-vydana"?: { dobropisovano?: string }[] }
  }
  return body.winstrom?.["faktura-vydana"]?.[0]?.dobropisovano
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
      externalCode: `ext:sandbox-test:${Date.now()}`,
      currency: "CZK",
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      customer: { name: "Sandbox Test Customer", countryCode: "CZ" },
      lines: [{ name: "Integration test item", quantity: 1, unitPrice: 1 }],
      vatPayer: false,
    })
    expect(result.id).toBeTruthy()
    expect(result.code).toMatch(/^ext:sandbox-test:/)
  })

  it("fetches a just-created invoice as a PDF", async () => {
    const client = new AbraFlexiClient({
      baseUrl: baseUrl!,
      company: company!,
      username: username!,
      password: password!,
    })
    const invoice = await client.createInvoice({
      externalCode: `ext:sandbox-test-pdf:${Date.now()}`,
      currency: "CZK",
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      customer: { name: "Sandbox Test Customer", countryCode: "CZ" },
      lines: [{ name: "Integration test item", quantity: 1, unitPrice: 1 }],
      vatPayer: false,
    })

    const pdf = await client.getInvoicePdf(invoice.id)

    expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
  })

  it("records a payment against a just-created invoice", async () => {
    const client = new AbraFlexiClient({
      baseUrl: baseUrl!,
      company: company!,
      username: username!,
      password: password!,
    })

    const externalCode = `ext:sandbox-test-payment:${Date.now()}`
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
    expect(stavUhrK).toBe(ABRA_FLEXI_PAYMENT_STATUS_CODE_PAID_MANUALLY)
  })

  it("creates a credit note and links it to a just-created invoice", async () => {
    const client = new AbraFlexiClient({
      baseUrl: baseUrl!,
      company: company!,
      username: username!,
      password: password!,
    })

    const invoiceExternalCode = `ext:sandbox-test-invoice-for-credit:${Date.now()}`
    await client.createInvoice({
      externalCode: invoiceExternalCode,
      currency: "CZK",
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      customer: { name: "Sandbox Test Customer", countryCode: "CZ" },
      lines: [{ name: "Integration test item", quantity: 1, unitPrice: 100 }],
      vatPayer: false,
    })

    const creditNoteExternalCode = `ext:sandbox-test-credit:${Date.now()}`
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

    expect(await fetchInvoiceDobropisovano(invoiceExternalCode)).toBe("true")
  })
})
