import { describe, it, expect, vi, beforeEach } from "vitest"
import { PacketaClient, PacketaError } from "../packeta-client"

const opts = { apiPassword: "deadbeef".repeat(4) } // 32 hex chars

function mockFetchOnce(status: number, xml: string) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => xml,
  }) as unknown as typeof fetch
}

beforeEach(() => vi.restoreAllMocks())

describe("PacketaClient.createPacket", () => {
  it("POSTs XML rooted at the method name with apiPassword first, returns id+barcode as strings", async () => {
    mockFetchOnce(
      200,
      `<response status="ok"><result><id>9007199254740993</id><barcode>Z9007199254740993</barcode></result></response>`
    )
    const client = new PacketaClient(opts)
    const res = await client.createPacket({
      number: "42",
      name: "Jan",
      surname: "Novák",
      email: "jan@example.com",
      addressId: "79",
      value: 145.5,
      weight: 2,
    })
    // 64-bit id preserved as string (would lose precision as a JS number)
    expect(res.id).toBe("9007199254740993")
    expect(res.barcode).toBe("Z9007199254740993")

    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe("https://www.zasilkovna.cz/api/rest")
    expect(call[1].method).toBe("POST")
    const body = call[1].body as string
    expect(body).toContain("<createPacket>")
    // apiPassword present and appears before the recipient name
    expect(body.indexOf("<apiPassword>")).toBeGreaterThan(-1)
    expect(body.indexOf("<apiPassword>")).toBeLessThan(body.indexOf("<name>"))
  })

  it("throws PacketaError on a fault response", async () => {
    mockFetchOnce(
      200,
      `<response status="fault"><fault>IncorrectApiPasswordFault</fault><string>Wrong password</string></response>`
    )
    const client = new PacketaClient(opts)
    await expect(
      client.createPacket({
        number: "1",
        name: "A",
        surname: "B",
        addressId: "79",
        value: 1,
        weight: 1,
      })
    ).rejects.toBeInstanceOf(PacketaError)
  })

  it("tags 5xx as retryable", async () => {
    mockFetchOnce(503, "")
    await expect(
      new PacketaClient(opts).createPacket({
        number: "1",
        name: "A",
        surname: "B",
        addressId: "79",
        value: 1,
        weight: 1,
      })
    ).rejects.toMatchObject({ retryable: true })
  })
})
