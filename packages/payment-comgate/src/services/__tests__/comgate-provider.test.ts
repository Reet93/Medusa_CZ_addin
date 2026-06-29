import { describe, it, expect, vi, beforeEach } from "vitest"

const create = vi.fn()
const status = vi.fn()
const capturePreauth = vi.fn()
const refund = vi.fn()
const cancelPreauth = vi.fn()
vi.mock("../../core/comgate-client", async (orig) => {
  const actual = await orig<typeof import("../../core/comgate-client")>()
  return {
    ...actual,
    ComgateClient: vi
      .fn()
      .mockImplementation(() => ({ create, status, capturePreauth, refund, cancelPreauth })),
  }
})

import ComgateProviderService from "../comgate-provider"
import type { ComgateOptions } from "../../types"

const options: ComgateOptions = { merchant: "123456", secret: "s", test: true }
function makeProvider(opts: ComgateOptions = options) {
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

describe("authorizePayment", () => {
  it("auto mode: PAID → captured (Medusa auto-captures)", async () => {
    status.mockResolvedValue({ code: 0, status: "PAID" })
    const res = await makeProvider({ ...options, capture: "automatic" }).authorizePayment({
      data: { transId: "T1" },
    } as never)
    expect(res.status).toBe("captured")
  })
  it("manual mode: AUTHORIZED → authorized", async () => {
    status.mockResolvedValue({ code: 0, status: "AUTHORIZED" })
    const res = await makeProvider({ ...options, capture: "manual" }).authorizePayment({
      data: { transId: "T1" },
    } as never)
    expect(res.status).toBe("authorized")
  })
  it("still pending → pending", async () => {
    status.mockResolvedValue({ code: 0, status: "PENDING" })
    const res = await makeProvider().authorizePayment({ data: { transId: "T1" } } as never)
    expect(res.status).toBe("pending")
  })
})

describe("capturePayment", () => {
  it("auto mode: no-op (no preauth capture call)", async () => {
    await makeProvider({ ...options, capture: "automatic" }).capturePayment({
      data: { transId: "T1" },
    } as never)
    expect(capturePreauth).not.toHaveBeenCalled()
  })
  it("manual mode: calls capturePreauth", async () => {
    capturePreauth.mockResolvedValue({ code: 0, message: "OK" })
    await makeProvider({ ...options, capture: "manual" }).capturePayment({
      data: { transId: "T1" },
    } as never)
    expect(capturePreauth).toHaveBeenCalledWith("T1", undefined)
  })
})

describe("refundPayment", () => {
  it("refunds the given amount in minor units, with currency from session data", async () => {
    refund.mockResolvedValue({ code: 0, message: "OK" })
    await makeProvider().refundPayment({ amount: 5, data: { transId: "T1", curr: "CZK" } } as never)
    expect(refund).toHaveBeenCalledWith("T1", 500, "CZK")
  })
})

describe("cancelPayment / deletePayment", () => {
  it("manual mode cancels the preauth", async () => {
    cancelPreauth.mockResolvedValue({ code: 0, message: "OK" })
    await makeProvider({ ...options, capture: "manual" }).cancelPayment({
      data: { transId: "T1", status: "AUTHORIZED" },
    } as never)
    expect(cancelPreauth).toHaveBeenCalledWith("T1")
  })
  it("automatic mode is a best-effort no-op", async () => {
    await makeProvider({ ...options, capture: "automatic" }).cancelPayment({
      data: { transId: "T1" },
    } as never)
    expect(cancelPreauth).not.toHaveBeenCalled()
  })
})
