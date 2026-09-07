import { describe, it, expect, vi, beforeEach } from "vitest"
import { AbraFlexiClient, AbraFlexiApiError } from "../abra-flexi-client"
import {
  ABRA_FLEXI_VAT_RATE_CODE_BASIC,
  ABRA_FLEXI_PAYMENT_STATUS_CODE_PAID_MANUALLY,
  ABRA_FLEXI_DOCUMENT_TYPE_CODE_CREDIT_NOTE,
} from "../../types"
import type { AbraFlexiInvoicePayload, AbraFlexiCreditNotePayload } from "../../types"

const opts = {
  baseUrl: "https://demo.flexibee.eu:5434",
  company: "demo_company",
  username: "winstrom",
  password: "winstrom",
}

const payload: AbraFlexiInvoicePayload = {
  externalCode: "order-ord_123",
  currency: "CZK",
  issueDate: "2026-09-03",
  dueDate: "2026-09-17",
  customer: {
    name: "Jan Novák",
    street: "Hlavní 1",
    city: "Praha",
    postalCode: "11000",
    countryCode: "CZ",
  },
  lines: [{ name: "Tričko", quantity: 2, unitPrice: 299 }],
  vatPayer: false,
}

let mockFetchFn: ReturnType<typeof vi.fn> | null = null

function mockFetchOnce(status: number, body: unknown) {
  if (!mockFetchFn) {
    mockFetchFn = vi.fn()
    globalThis.fetch = mockFetchFn as unknown as typeof fetch
  }
  mockFetchFn.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

describe("AbraFlexiClient.createInvoice", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockFetchFn = null
  })

  it("PUTs to the faktura-vydana collection URL with Basic auth", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "12345" }] } })
    const client = new AbraFlexiClient(opts)
    await client.createInvoice(payload)
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(call[0]).toBe("https://demo.flexibee.eu:5434/c/demo_company/faktura-vydana.json")
    expect(call[1].method).toBe("PUT")
    expect(call[1].headers.Authorization).toBe(
      "Basic " + Buffer.from("winstrom:winstrom").toString("base64")
    )
    expect(call[1].headers["Content-Type"]).toBe("application/json")
  })

  it("sends the external id, dates, currency, and customer fields", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "12345" }] } })
    await new AbraFlexiClient(opts).createInvoice(payload)
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    const body = JSON.parse(call[1].body)
    const invoice = body.winstrom["faktura-vydana"]
    expect(invoice.id).toBe("code:order-ord_123")
    expect(invoice.datVyd).toBe("2026-09-03")
    expect(invoice.splatnost).toBe("2026-09-17")
    expect(invoice.mena).toBe("code:CZK")
    expect(invoice.nazFirma).toBe("Jan Novák")
    expect(invoice.ulice).toBe("Hlavní 1")
    expect(invoice.mesto).toBe("Praha")
    expect(invoice.psc).toBe("11000")
    expect(invoice.stat).toBe("code:CZ")
  })

  it("omits ic/dic when not provided, and includes them when present", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "1" }] } })
    await new AbraFlexiClient(opts).createInvoice(payload)
    let body = JSON.parse(
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body
    )
    expect(body.winstrom["faktura-vydana"].ic).toBeUndefined()

    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "1" }] } })
    await new AbraFlexiClient(opts).createInvoice({
      ...payload,
      customer: { ...payload.customer, ico: "25063677", dic: "CZ25063677" },
    })
    body = JSON.parse(
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[1]![1].body
    )
    expect(body.winstrom["faktura-vydana"].ic).toBe("25063677")
    expect(body.winstrom["faktura-vydana"].dic).toBe("CZ25063677")
  })

  it("sends each line without VAT fields when vatRate is unset (non-payer)", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "1" }] } })
    await new AbraFlexiClient(opts).createInvoice(payload)
    const body = JSON.parse(
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body
    )
    const line = body.winstrom["faktura-vydana"].polozkyFaktury[0]["faktura-vydana-polozka"]
    expect(line).toEqual({ nazev: "Tričko", mnozMj: 2, cenaMj: 299 })
  })

  it("tags each line with the basic VAT rate code when vatRate is set (payer)", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "1" }] } })
    await new AbraFlexiClient(opts).createInvoice({
      ...payload,
      vatPayer: true,
      lines: [{ name: "Tričko", quantity: 2, unitPrice: 299, vatRate: 0.21 }],
    })
    const body = JSON.parse(
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body
    )
    const line = body.winstrom["faktura-vydana"].polozkyFaktury[0]["faktura-vydana-polozka"]
    expect(line.typCenyDphK).toBe("typCeny.bezDph")
    expect(line.typSzbDphK).toBe(ABRA_FLEXI_VAT_RATE_CODE_BASIC)
  })

  it("resolves with the numeric id and our external code", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "12345" }] } })
    const result = await new AbraFlexiClient(opts).createInvoice(payload)
    expect(result).toEqual({ id: "12345", code: "order-ord_123" })
  })

  it("throws a retryable AbraFlexiApiError on a 5xx response", async () => {
    mockFetchOnce(500, {
      winstrom: { success: false, results: [{ id: "0", errors: [{ message: "boom" }] }] },
    })
    await expect(new AbraFlexiClient(opts).createInvoice(payload)).rejects.toMatchObject({
      name: "AbraFlexiApiError",
      status: 500,
      retryable: true,
      message: "boom",
    })
  })

  it("throws a non-retryable AbraFlexiApiError on a 400 response", async () => {
    mockFetchOnce(400, {
      winstrom: { success: false, results: [{ id: "0", errors: [{ message: "Invalid mena" }] }] },
    })
    await expect(new AbraFlexiClient(opts).createInvoice(payload)).rejects.toMatchObject({
      name: "AbraFlexiApiError",
      status: 400,
      retryable: false,
      message: "Invalid mena",
    })
  })

  it("falls back to a generic message when the error body has no errors array", async () => {
    mockFetchOnce(401, {})
    await expect(new AbraFlexiClient(opts).createInvoice(payload)).rejects.toMatchObject({
      name: "AbraFlexiApiError",
      status: 401,
      retryable: false,
      message: "Abra Flexi HTTP 401",
    })
  })

  it("throws a retryable error on a network failure", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNRESET")) as unknown as typeof fetch
    await expect(new AbraFlexiClient(opts).createInvoice(payload)).rejects.toMatchObject({
      name: "AbraFlexiApiError",
      status: 0,
      retryable: true,
    })
  })
})

describe("AbraFlexiClient.recordPayment", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockFetchFn = null
  })

  it("PUTs to the faktura-vydana collection URL with Basic auth", async () => {
    mockFetchOnce(200, { winstrom: { success: true, results: [{ id: "1" }] } })
    const client = new AbraFlexiClient(opts)
    await client.recordPayment({ invoiceExternalCode: "order-ord_123" })
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(call[0]).toBe("https://demo.flexibee.eu:5434/c/demo_company/faktura-vydana.json")
    expect(call[1].method).toBe("PUT")
    expect(call[1].headers.Authorization).toBe(
      "Basic " + Buffer.from("winstrom:winstrom").toString("base64")
    )
    expect(call[1].headers["Content-Type"]).toBe("application/json")
  })

  it("sends only the invoice id and the manual-paid status code", async () => {
    mockFetchOnce(200, { winstrom: { success: true, results: [{ id: "1" }] } })
    await new AbraFlexiClient(opts).recordPayment({ invoiceExternalCode: "order-ord_123" })
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    const body = JSON.parse(call[1].body)
    expect(body.winstrom["faktura-vydana"]).toEqual({
      id: "code:order-ord_123",
      stavUhrK: `code:${ABRA_FLEXI_PAYMENT_STATUS_CODE_PAID_MANUALLY}`,
    })
  })

  it("resolves with the numeric id", async () => {
    mockFetchOnce(200, { winstrom: { success: true, results: [{ id: "42" }] } })
    const result = await new AbraFlexiClient(opts).recordPayment({
      invoiceExternalCode: "order-ord_123",
    })
    expect(result).toEqual({ id: "42" })
  })

  it("throws a retryable AbraFlexiApiError on a 5xx response", async () => {
    mockFetchOnce(500, {
      winstrom: { success: false, results: [{ id: "0", errors: [{ message: "boom" }] }] },
    })
    await expect(
      new AbraFlexiClient(opts).recordPayment({ invoiceExternalCode: "order-ord_123" })
    ).rejects.toMatchObject({
      name: "AbraFlexiApiError",
      status: 500,
      retryable: true,
      message: "boom",
    })
  })

  it("throws a non-retryable AbraFlexiApiError on a 404 response (invoice not found)", async () => {
    mockFetchOnce(404, {
      winstrom: {
        success: false,
        results: [{ id: "0", errors: [{ message: "Record not found" }] }],
      },
    })
    await expect(
      new AbraFlexiClient(opts).recordPayment({ invoiceExternalCode: "order-ord_123" })
    ).rejects.toMatchObject({
      name: "AbraFlexiApiError",
      status: 404,
      retryable: false,
      message: "Record not found",
    })
  })

  it("throws a retryable error on a network failure", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNRESET")) as unknown as typeof fetch
    await expect(
      new AbraFlexiClient(opts).recordPayment({ invoiceExternalCode: "order-ord_123" })
    ).rejects.toMatchObject({ name: "AbraFlexiApiError", status: 0, retryable: true })
  })
})

describe("AbraFlexiClient.createCreditNote", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockFetchFn = null
  })

  const creditNotePayload: AbraFlexiCreditNotePayload = {
    externalCode: "order-ord_123-credit-ref_1",
    originalInvoiceExternalCode: "order-ord_123",
    currency: "CZK",
    issueDate: "2026-09-07",
    dueDate: "2026-09-21",
    customer: { name: "Jan Novák", countryCode: "CZ" },
    lines: [{ name: "Refund", quantity: -1, unitPrice: 100 }],
    vatPayer: false,
  }

  it("PUTs twice to the same faktura-vydana collection URL: create, then link", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "555" }] } })
    mockFetchOnce(200, { winstrom: { success: true, results: [{ id: "555" }] } })
    await new AbraFlexiClient(opts).createCreditNote(creditNotePayload)
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0]![0]).toBe("https://demo.flexibee.eu:5434/c/demo_company/faktura-vydana.json")
    expect(calls[0]![1].method).toBe("PUT")
    expect(calls[1]![0]).toBe("https://demo.flexibee.eu:5434/c/demo_company/faktura-vydana.json")
    expect(calls[1]![1].method).toBe("PUT")
  })

  it("sends typDokl DOBROPIS, the record's own code, and its own line items on the first PUT", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "555" }] } })
    mockFetchOnce(200, { winstrom: { success: true, results: [{ id: "555" }] } })
    await new AbraFlexiClient(opts).createCreditNote(creditNotePayload)
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    const record = JSON.parse(calls[0]![1].body).winstrom["faktura-vydana"]
    expect(record.id).toBe("code:order-ord_123-credit-ref_1")
    expect(record.typDokl).toBe(`code:${ABRA_FLEXI_DOCUMENT_TYPE_CODE_CREDIT_NOTE}`)
    expect(record.mena).toBe("code:CZK")
    expect(record.polozkyFaktury[0]["faktura-vydana-polozka"]).toEqual({
      nazev: "Refund",
      mnozMj: -1,
      cenaMj: 100,
    })
  })

  it("sends only the link field, addressing the credit note's own code, on the second PUT", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "555" }] } })
    mockFetchOnce(200, { winstrom: { success: true, results: [{ id: "555" }] } })
    await new AbraFlexiClient(opts).createCreditNote(creditNotePayload)
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    const secondBody = JSON.parse(calls[1]![1].body)
    expect(secondBody.winstrom["faktura-vydana"]).toEqual({
      id: "code:order-ord_123-credit-ref_1",
      "vytvor-vazbu-dobropis": { dobropisovanyDokl: "code:order-ord_123" },
    })
  })

  it("resolves with the created credit note's numeric id and its own external code", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "555" }] } })
    mockFetchOnce(200, { winstrom: { success: true, results: [{ id: "555" }] } })
    const result = await new AbraFlexiClient(opts).createCreditNote(creditNotePayload)
    expect(result).toEqual({ id: "555", code: "order-ord_123-credit-ref_1" })
  })

  it("does not attempt the link PUT when the create PUT fails, and throws its error as-is", async () => {
    mockFetchOnce(400, {
      winstrom: { success: false, results: [{ id: "0", errors: [{ message: "bad payload" }] }] },
    })
    await expect(
      new AbraFlexiClient(opts).createCreditNote(creditNotePayload)
    ).rejects.toMatchObject({
      name: "AbraFlexiApiError",
      status: 400,
      retryable: false,
      message: "bad payload",
    })
    expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
  })

  it("treats a 5xx on the create PUT as retryable", async () => {
    mockFetchOnce(500, {
      winstrom: { success: false, results: [{ id: "0", errors: [{ message: "boom" }] }] },
    })
    await expect(
      new AbraFlexiClient(opts).createCreditNote(creditNotePayload)
    ).rejects.toMatchObject({ name: "AbraFlexiApiError", status: 500, retryable: true })
  })

  it("wraps a non-retryable link-PUT failure with an 'orphaned credit note' message, preserving its status", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "555" }] } })
    mockFetchOnce(400, {
      winstrom: {
        success: false,
        results: [{ id: "0", errors: [{ message: "already linked to another document" }] }],
      },
    })
    await expect(
      new AbraFlexiClient(opts).createCreditNote(creditNotePayload)
    ).rejects.toMatchObject({
      name: "AbraFlexiApiError",
      status: 400,
      retryable: false,
      message: expect.stringContaining(
        'credit note "order-ord_123-credit-ref_1" (id "555") was created but linking it to invoice "order-ord_123" failed: already linked to another document'
      ),
    })
  })

  it("wraps a retryable (5xx) link-PUT failure the same way, preserving retryable: true", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "555" }] } })
    mockFetchOnce(500, {
      winstrom: { success: false, results: [{ id: "0", errors: [{ message: "boom" }] }] },
    })
    await expect(
      new AbraFlexiClient(opts).createCreditNote(creditNotePayload)
    ).rejects.toMatchObject({ name: "AbraFlexiApiError", status: 500, retryable: true })
  })
})

