import { describe, it, expect, vi, beforeEach } from "vitest"

const create = vi.fn()
const status = vi.fn()
vi.mock("../../core/comgate-client", async (orig) => {
  const actual = await orig<typeof import("../../core/comgate-client")>()
  return {
    ...actual,
    ComgateClient: vi.fn().mockImplementation(() => ({ create, status })),
  }
})

import ComgateProviderService from "../comgate-provider"

const options = { merchant: "123456", secret: "s", test: true }
function makeProvider(opts = options) {
  return new ComgateProviderService({} as Record<string, unknown>, opts)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("initiatePayment", () => {
  it("creates a Comgate tx and returns id + redirect data", async () => {
    create.mockResolvedValue({ code: 0, message: "OK", transId: "T1", redirect: "https://pay/T1" })
    const provider = makeProvider()
    const res = await provider.initiatePayment({
      amount: 10, // 10.00 CZK
      currency_code: "czk",
      data: { session_id: "ps_1" },
    } as never)
    expect(res.id).toBe("T1")
    expect((res.data as Record<string, unknown>).redirect_url).toBe("https://pay/T1")
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ price: 1000, curr: "CZK", prepareOnly: true })
    )
  })
})

describe("getPaymentStatus maps Comgate→Medusa", () => {
  it.each([
    ["PAID", "captured"],
    ["PENDING", "pending"],
    ["CANCELLED", "canceled"],
  ])("%s → %s", async (cg, medusa) => {
    status.mockResolvedValue({ code: 0, status: cg })
    const provider = makeProvider()
    const res = await provider.getPaymentStatus({ data: { transId: "T1" } } as never)
    expect(res.status).toBe(medusa)
  })
})
