import { describe, expect, it, vi } from "vitest"
import { GET } from "../route"

// E2E 2026-11-04: the admin showed no packet number or label for a Packeta fulfilment, so the
// shop owner had to find the parcel in the Packeta portal. The order widget links here.
function call(packetId: string, docs: Array<{ base64: string; mime: string }>) {
  const getShipmentDocuments = vi.fn().mockResolvedValue(docs)
  const res: any = {
    headers: {} as Record<string, string>,
    setHeader: (k: string, v: string) => ((res.headers[k.toLowerCase()] = v), res),
    status: (c: number) => ((res.statusCode = c), res),
    json: (b: unknown) => ((res.body = b), res),
    send: (b: unknown) => ((res.body = b), res),
  }
  const req = { params: { packetId }, scope: { resolve: () => ({ getShipmentDocuments }) } }
  return GET(req as never, res).then(() => ({ res, getShipmentDocuments }))
}

describe("GET /admin/packeta/label/:packetId", () => {
  it("returns the label PDF for the packet", async () => {
    const pdf = Buffer.from("%PDF-1.4").toString("base64")
    const { res, getShipmentDocuments } = await call("4411280835", [
      { base64: pdf, mime: "application/pdf" },
    ])
    expect(getShipmentDocuments).toHaveBeenCalledWith({ packet_id: "4411280835" })
    expect(res.headers["content-type"]).toBe("application/pdf")
    expect(Buffer.from(res.body as Buffer).toString()).toBe("%PDF-1.4")
  })

  it("refuses a packet id that is not a number", async () => {
    const { res, getShipmentDocuments } = await call("../x", [])
    expect(res.statusCode).toBe(400)
    expect(getShipmentDocuments).not.toHaveBeenCalled()
  })
})
