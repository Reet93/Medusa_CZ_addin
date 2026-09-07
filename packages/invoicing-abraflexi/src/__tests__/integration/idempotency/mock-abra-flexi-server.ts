import { createServer, type Server } from "node:http"

export interface MockAbraFlexiServer {
  baseUrl: string
  callCount: () => number
  paymentRecordCallCount: () => number
  close: () => Promise<void>
}

// Stands in for the real Abra Flexi API in the idempotency-guard integration tests
// (create-invoice-idempotency.test.ts, record-payment-idempotency.test.ts). No
// network, no sandbox credentials -- just enough of PUT
// /c/{company}/faktura-vydana.json's response shape for both
// AbraFlexiClient.createInvoice() and .recordPayment() to parse a success result
// (both PUT to the same endpoint -- Option A in
// docs/superpowers/research/2026-09-06-abra-flexi-payment-api-verification.md
// reuses faktura-vydana.json rather than a separate evidence type). The two call
// counters are told apart by body shape: a payment-status update body only ever
// contains `stavUhrK`, a create call never does. The tests assert on these counts
// to prove each workflow's own idempotency guard, not this mock, is what prevents
// duplicate calls on a retried/duplicated payment.captured event.
export async function startMockAbraFlexiServer(): Promise<MockAbraFlexiServer> {
  let createCalls = 0
  let paymentRecordCalls = 0

  const server: Server = createServer((req, res) => {
    if (req.method === "PUT" && req.url?.endsWith("/faktura-vydana.json")) {
      const chunks: Buffer[] = []
      req.on("data", (chunk: Buffer) => chunks.push(chunk))
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
        const invoice = body?.winstrom?.["faktura-vydana"] ?? {}
        const isPaymentRecord = "stavUhrK" in invoice
        if (isPaymentRecord) {
          paymentRecordCalls++
        } else {
          createCalls++
        }
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({
            winstrom: {
              success: true,
              results: [{ id: String(isPaymentRecord ? paymentRecordCalls : createCalls) }],
            },
          })
        )
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
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
