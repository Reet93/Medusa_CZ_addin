import { describe, it, expect, vi, beforeEach } from "vitest"
import { validatePoint } from "../widget-validate"

function mockJsonOnce(status: number, body: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch
}

beforeEach(() => vi.restoreAllMocks())

describe("validatePoint", () => {
  it("POSTs apiKey + point to the validate endpoint and returns isValid", async () => {
    mockJsonOnce(200, { isValid: true, errors: [] })
    const res = await validatePoint({ apiKey: "KEY", point: { id: "79" } })
    expect(res).toEqual({ isValid: true, errors: [] })
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe("https://widget.packeta.com/v6/pps/api/widget/v1/validate")
    expect(JSON.parse(call[1].body)).toMatchObject({ apiKey: "KEY", point: { id: "79" } })
  })

  it("returns isValid=false with mapped errors", async () => {
    mockJsonOnce(200, {
      isValid: false,
      errors: [{ code: "NotFound" }, { code: "NoCashOnDelivery" }],
    })
    const res = await validatePoint({ apiKey: "KEY", point: { id: "1" } })
    expect(res.isValid).toBe(false)
    expect(res.errors).toEqual(["NotFound", "NoCashOnDelivery"])
  })

  it("treats a 401 as invalid with an api-key error", async () => {
    mockJsonOnce(401, {})
    const res = await validatePoint({ apiKey: "BAD", point: { id: "1" } })
    expect(res.isValid).toBe(false)
    expect(res.errors).toContain("InvalidApiKey")
  })
})
