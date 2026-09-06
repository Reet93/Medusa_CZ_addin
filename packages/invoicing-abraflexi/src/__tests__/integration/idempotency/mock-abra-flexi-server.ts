import { createServer, type Server } from "node:http"

export interface MockAbraFlexiServer {
  baseUrl: string
  callCount: () => number
  close: () => Promise<void>
}

// Stands in for the real Abra Flexi API in the idempotency-guard integration test
// (create-invoice-idempotency.test.ts). No network, no sandbox credentials --
// just enough of PUT /c/{company}/faktura-vydana.json's response shape for
// AbraFlexiClient.createInvoice() to parse a success result. The test asserts
// on callCount() to prove the workflow's idempotency guard, not this client, is
// what prevents a second invoice on a retried/duplicated payment.captured event.
export async function startMockAbraFlexiServer(): Promise<MockAbraFlexiServer> {
  let calls = 0

  const server: Server = createServer((req, res) => {
    if (req.method === "PUT" && req.url?.endsWith("/faktura-vydana.json")) {
      calls++
      // Drain the request body -- Node won't emit "close"/end the response
      // reliably otherwise.
      req.resume()
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(
        JSON.stringify({
          winstrom: { success: true, results: [{ id: String(calls) }] },
        })
      )
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
    callCount: () => calls,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
