import { describe, it, expect } from "vitest"
import { ComgateClient } from "../../core/comgate-client"

const merchant = process.env.COMGATE_MERCHANT
const secret = process.env.COMGATE_SECRET
const run = merchant && secret ? describe : describe.skip

run("Comgate sandbox (live, test=true)", () => {
  const client = new ComgateClient({ merchant: merchant!, secret: secret!, test: true })

  it("creates a test payment and returns a redirect URL", async () => {
    const res = await client.create({
      price: 1000,
      curr: "CZK",
      label: "M1 sandbox",
      refId: `it-${Date.now()}`,
      prepareOnly: true,
      method: "ALL",
      email: "test@example.com",
    })
    expect(res.transId).toBeTruthy()
    expect(res.redirect).toContain("comgate.cz")

    const status = await client.status(res.transId)
    expect(["PENDING", "PAID", "CANCELLED", "AUTHORIZED"]).toContain(status.status)
  })
})
