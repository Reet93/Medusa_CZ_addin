import { createServer, type Server } from "node:http"

export interface MockAbraFlexiServer {
  baseUrl: string
  callCount: () => number
  paymentRecordCallCount: () => number
  creditNoteCreateCallCount: () => number
  creditNoteLinkCallCount: () => number
  close: () => Promise<void>
}

// Stands in for the real Abra Flexi API in the idempotency-guard integration
// tests (create-invoice-idempotency.test.ts, record-payment-idempotency.test.ts,
// credit-note-idempotency.test.ts). No network, no sandbox credentials -- just
// enough of PUT /c/{company}/faktura-vydana.json's response shape for
// AbraFlexiClient.createInvoice()/.recordPayment()/.createCreditNote() to each
// parse a success result (all four write shapes PUT to the same endpoint --
// see docs/superpowers/research/2026-09-07-abra-flexi-credit-notes-api-verification.md
// Part 1 for why credit notes reuse faktura-vydana.json too). The four call
// counters are told apart by body shape, most-specific first:
//   - a link PUT only ever carries `vytvor-vazbu-dobropis`
//   - a credit-note create PUT carries `typDokl: "code:DOBROPIS"` (and no link field)
//   - a payment-status PUT only ever carries `stavUhrK`
//   - anything else is a plain invoice create
// The tests assert on these counts to prove each workflow's own idempotency
// guard, not this mock, is what prevents duplicate calls on a
// retried/duplicated event.
export async function startMockAbraFlexiServer(): Promise<MockAbraFlexiServer> {
  let createCalls = 0
  let paymentRecordCalls = 0
  let creditNoteCreateCalls = 0
  let creditNoteLinkCalls = 0

  const server: Server = createServer((req, res) => {
    if (req.method === "PUT" && req.url?.endsWith("/faktura-vydana.json")) {
      const chunks: Buffer[] = []
      req.on("data", (chunk: Buffer) => chunks.push(chunk))
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
        const invoice = body?.winstrom?.["faktura-vydana"] ?? {}
        const isLink = "vytvor-vazbu-dobropis" in invoice
        const isCreditNoteCreate = !isLink && invoice.typDokl === "code:DOBROPIS"
        const isPaymentRecord = !isLink && !isCreditNoteCreate && "stavUhrK" in invoice

        let id: number
        if (isLink) {
          creditNoteLinkCalls++
          id = creditNoteLinkCalls
        } else if (isCreditNoteCreate) {
          creditNoteCreateCalls++
          id = creditNoteCreateCalls
        } else if (isPaymentRecord) {
          paymentRecordCalls++
          id = paymentRecordCalls
        } else {
          createCalls++
          id = createCalls
        }

        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ winstrom: { success: true, results: [{ id: String(id) }] } }))
      })
      return
    }
    res.writeHead(404)
    res.end()
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })

  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("Mock Abra Flexi server failed to bind a local port")
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    callCount: () => createCalls,
    paymentRecordCallCount: () => paymentRecordCalls,
    creditNoteCreateCallCount: () => creditNoteCreateCalls,
    creditNoteLinkCallCount: () => creditNoteLinkCalls,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
