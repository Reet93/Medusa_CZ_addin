import { describe, it, expect, vi, beforeEach } from "vitest"
import { ComgateClient, ComgateError, toMinorUnits } from "../comgate-client"

const opts = { merchant: "123456", secret: "s3cr3t", test: true }

function mockFetchOnce(status: number, body: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as typeof fetch
}

describe("toMinorUnits", () => {
  it("converts major to integer minor units", () => {
    expect(toMinorUnits(10)).toBe(1000)
    expect(toMinorUnits(10.5)).toBe(1050)
    expect(toMinorUnits(10.005)).toBe(1001) // rounds
  })
})

describe("ComgateClient.create", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("POSTs to /payment.json with Basic auth and returns transId+redirect", async () => {
    mockFetchOnce(200, {
      code: 0,
      message: "OK",
      transId: "AB12-CD34",
      redirect: "https://payments.comgate.cz/client/instructions/index?id=AB12-CD34",
    })
    const client = new ComgateClient(opts)
    const res = await client.create({
      price: 1000,
      curr: "CZK",
      label: "Order 42",
      refId: "ps_1",
      prepareOnly: true,
      method: "ALL",
    })
    expect(res.transId).toBe("AB12-CD34")
    expect(res.redirect).toContain("payments.comgate.cz")
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(call[0]).toBe("https://payments.comgate.cz/v2.0/payment.json")
    expect(call[1].method).toBe("POST")
    expect(call[1].headers.Authorization).toBe(
      "Basic " + Buffer.from("123456:s3cr3t").toString("base64")
    )
  })

  it("throws ComgateError when code != 0", async () => {
    mockFetchOnce(200, { code: 1309, message: "Wrong amount" })
    const client = new ComgateClient(opts)
    await expect(
      client.create({ price: -1, curr: "CZK", label: "x", refId: "ps_1", prepareOnly: true })
    ).rejects.toMatchObject({ name: "ComgateError", code: 1309 })
  })
})
