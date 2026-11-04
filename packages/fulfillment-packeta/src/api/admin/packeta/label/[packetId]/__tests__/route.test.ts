import { beforeEach, describe, expect, it, vi } from "vitest"

const { getShipmentDocuments, ctor } = vi.hoisted(() => ({
  getShipmentDocuments: vi.fn(),
  ctor: vi.fn(),
}))
vi.mock("../../../../../../providers/packeta/service.js", () => ({
  default: class {
    constructor(_c: unknown, opts: unknown) {
      ctor(opts)
    }
    getShipmentDocuments = getShipmentDocuments
  },
}))

import { GET } from "../route"

// E2E 2026-11-04: the admin showed no packet number or label for a Packeta fulfilment. The first
// version resolved the provider from the request scope, which fails live (module providers live
// in the fulfillment module's container); the provider is built from its configured options.
const configModule = {
  modules: {
    fulfillment: {
      options: {
        providers: [
          {
            resolve: "@medusa-cz/fulfillment-packeta/providers/packeta",
            options: { apiPassword: "pw" },
          },
        ],
      },
    },
  },
}

function call(packetId: string, config: unknown = configModule) {
  const res: any = {
    headers: {} as Record<string, string>,
    setHeader: (k: string, v: string) => ((res.headers[k.toLowerCase()] = v), res),
    status: (c: number) => ((res.statusCode = c), res),
    json: (b: unknown) => ((res.body = b), res),
    send: (b: unknown) => ((res.body = b), res),
  }
  const req = {
    params: { packetId },
    scope: { resolve: (key: string) => (key === "configModule" ? config : undefined) },
  }
  return GET(req as never, res).then(() => res)
}

beforeEach(() => vi.clearAllMocks())

describe("GET /admin/packeta/label/:packetId", () => {
  it("returns the label PDF using the configured provider", async () => {
    getShipmentDocuments.mockResolvedValue([
      { base64: Buffer.from("%PDF-1.4").toString("base64"), mime: "application/pdf" },
    ])
    const res = await call("4411280835")
    expect(ctor).toHaveBeenCalledWith({ apiPassword: "pw" })
    expect(getShipmentDocuments).toHaveBeenCalledWith({ packet_id: "4411280835" })
    expect(res.headers["content-type"]).toBe("application/pdf")
    expect(Buffer.from(res.body as Buffer).toString()).toBe("%PDF-1.4")
  })

  it("refuses a packet id that is not a number", async () => {
    const res = await call("../x")
    expect(res.statusCode).toBe(400)
    expect(getShipmentDocuments).not.toHaveBeenCalled()
  })

  it("answers 503 when Packeta is not configured", async () => {
    const res = await call("1", { modules: {} })
    expect(res.statusCode).toBe(503)
  })
})
