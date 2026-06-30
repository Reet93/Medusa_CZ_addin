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

    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
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

describe("PacketaClient cancel/status/tracking", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("cancelPacket sends the packetId and resolves on ok", async () => {
    mockFetchOnce(200, `<response status="ok"><result/></response>`)
    await new PacketaClient(opts).cancelPacket("9007199254740993")
    const body = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1]
      .body as string
    expect(body).toContain("<cancelPacket>")
    expect(body).toContain("<packetId>9007199254740993</packetId>")
  })

  it("packetStatus returns code + text", async () => {
    mockFetchOnce(
      200,
      `<response status="ok"><result><statusCode>2</statusCode><statusText>Accepted</statusText></result></response>`
    )
    const res = await new PacketaClient(opts).packetStatus("1")
    expect(res).toEqual({ statusCode: "2", statusText: "Accepted" })
  })

  it("packetTracking returns an array even for a single record", async () => {
    mockFetchOnce(
      200,
      `<response status="ok"><result><record><statusCode>1</statusCode><statusText>Created</statusText></record></result></response>`
    )
    const res = await new PacketaClient(opts).packetTracking("1")
    expect(Array.isArray(res)).toBe(true)
    expect(res[0]).toMatchObject({ statusCode: "1", statusText: "Created" })
  })
})

describe("PacketaClient label/shipment/returns", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("packetLabelPdf returns the base64 string from <result>", async () => {
    mockFetchOnce(200, `<response status="ok"><result>JVBERi0xLjQK</result></response>`)
    const b64 = await new PacketaClient(opts).packetLabelPdf("1", "A6 on A4")
    expect(b64).toBe("JVBERi0xLjQK")
    const body = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1]
      .body as string
    expect(body).toContain("<packetLabelPdf>")
    expect(body).toContain("<format>A6 on A4</format>")
  })

  it("createShipment sends all packetIds and returns the shipment id", async () => {
    mockFetchOnce(
      200,
      `<response status="ok"><result><id>S123</id><barcode>BS123</barcode></result></response>`
    )
    const res = await new PacketaClient(opts).createShipment(["1", "2"])
    expect(res).toEqual({ id: "S123", barcode: "BS123" })
    const body = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1]
      .body as string
    expect(body).toContain("<createShipment>")
    expect(body).toContain("<id>1</id>")
    expect(body).toContain("<id>2</id>")
  })

  it("createPacketClaim returns id+barcode as strings", async () => {
    mockFetchOnce(
      200,
      `<response status="ok"><result><id>77</id><barcode>Z77</barcode></result></response>`
    )
    const res = await new PacketaClient(opts).createPacketClaim({ number: "ret-1", value: 10 })
    expect(res).toEqual({ id: "77", barcode: "Z77" })
    const body = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1]
      .body as string
    expect(body).toContain("<createPacketClaimWithPassword>")
  })

  it("senderGetReturnRouting returns an array of strings", async () => {
    mockFetchOnce(
      200,
      `<response status="ok"><result><string>r1</string><string>r2</string></result></response>`
    )
    const res = await new PacketaClient(opts).senderGetReturnRouting("my-sender")
    expect(res).toEqual(["r1", "r2"])
  })

  it("senderGetReturnRouting wraps a single <string> into an array", async () => {
    mockFetchOnce(200, `<response status="ok"><result><string>only</string></result></response>`)
    const res = await new PacketaClient(opts).senderGetReturnRouting("my-sender")
    expect(res).toEqual(["only"])
  })

  it("packetLabelPdf reads the base64 from a #text node", async () => {
    // A <result> with surrounding whitespace causes fast-xml-parser to emit { "#text": "..." }
    mockFetchOnce(200, `<response status="ok"><result> JVBERi0xLjQK </result></response>`)
    const b64 = await new PacketaClient(opts).packetLabelPdf("1", "A6 on A4")
    expect(b64.trim()).toBe("JVBERi0xLjQK")
  })

  it("packetLabelPdf throws PacketaError when result has no PDF content", async () => {
    mockFetchOnce(
      200,
      `<response status="ok"><result><unexpected>data</unexpected></result></response>`
    )
    await expect(new PacketaClient(opts).packetLabelPdf("1", "A6 on A4")).rejects.toMatchObject({
      fault: "LabelParseError",
    })
  })
})
