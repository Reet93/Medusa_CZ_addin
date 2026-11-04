import { describe, it, expect, vi, beforeEach } from "vitest"

const create = vi.fn()
const status = vi.fn()
const capturePreauth = vi.fn()
const refund = vi.fn()
const cancelPreauth = vi.fn()
const cancel = vi.fn()
vi.mock("../../core/comgate-client", async (orig) => {
  const actual = await orig<typeof import("../../core/comgate-client")>()
  return {
    ...actual,
    ComgateClient: vi.fn().mockImplementation(() => ({
      create,
      status,
      capturePreauth,
      refund,
      cancelPreauth,
      cancel,
    })),
  }
})

import { PaymentActions } from "@medusajs/framework/utils"
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

  it("maps locale 'cs' to Comgate lang 'cs'", async () => {
    create.mockResolvedValue({ code: 0, message: "OK", transId: "T1", redirect: "https://pay/T1" })
    const provider = makeProvider()
    await provider.initiatePayment({
      amount: 10,
      currency_code: "czk",
      data: { session_id: "ps_1", locale: "cs" },
    } as never)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ lang: "cs" }))
  })

  it("maps locale 'en' to Comgate lang 'en'", async () => {
    create.mockResolvedValue({ code: 0, message: "OK", transId: "T1", redirect: "https://pay/T1" })
    const provider = makeProvider()
    await provider.initiatePayment({
      amount: 10,
      currency_code: "czk",
      data: { session_id: "ps_1", locale: "en" },
    } as never)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ lang: "en" }))
  })

  it("defaults to lang 'cs' when locale is absent", async () => {
    create.mockResolvedValue({ code: 0, message: "OK", transId: "T1", redirect: "https://pay/T1" })
    const provider = makeProvider()
    await provider.initiatePayment({
      amount: 10,
      currency_code: "czk",
      data: { session_id: "ps_1" },
    } as never)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ lang: "cs" }))
  })

  it("defaults to lang 'cs' for an unsupported locale value rather than forwarding it as-is", async () => {
    create.mockResolvedValue({ code: 0, message: "OK", transId: "T1", redirect: "https://pay/T1" })
    const provider = makeProvider()
    await provider.initiatePayment({
      amount: 10,
      currency_code: "czk",
      data: { session_id: "ps_1", locale: "de" },
    } as never)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ lang: "cs" }))
  })
})

// Without an email Comgate asks the customer to type it again on its page (live test, 2026-10-26).
// 2026-11-04 E2E: the checkout's payment step initiated a session only to show the chosen method;
// that created a real Comgate transaction (and a "payment request" email to the customer), which
// the pay button then replaced. A deferred session records the choice without touching Comgate.
describe("deferred initiatePayment", () => {
  it("creates no Comgate transaction", async () => {
    const res = await makeProvider().initiatePayment({
      amount: 10,
      currency_code: "czk",
      data: { session_id: "ps_1", deferred: true, email: "a@b.cz" },
    } as never)
    expect(create).not.toHaveBeenCalled()
    expect(res.id).toMatch(/^deferred_/)
    expect(res.data).toEqual({ deferred: true })
  })

  it("is never authorized (the pay button replaces it with a real transaction)", async () => {
    const res = await makeProvider().authorizePayment({ data: { deferred: true } } as never)
    expect(status).not.toHaveBeenCalled()
    expect(res.status).toBe("pending")
  })

  it("deletes without calling Comgate", async () => {
    await makeProvider().deletePayment({ data: { deferred: true } } as never)
    expect(status).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
  })
})

describe("initiatePayment email", () => {
  beforeEach(() => {
    create.mockResolvedValue({ code: 0, message: "OK", transId: "T1", redirect: "https://pay/T1" })
  })
  it("passes the email the storefront put in the session data", async () => {
    await makeProvider().initiatePayment({
      amount: 10,
      currency_code: "czk",
      data: { email: "jan@example.com" },
    } as never)
    expect(create.mock.calls[0]![0].email).toBe("jan@example.com")
  })
  it("falls back to the logged-in customer's email", async () => {
    await makeProvider().initiatePayment({
      amount: 10,
      currency_code: "czk",
      data: {},
      context: { customer: { email: "eva@example.com" } },
    } as never)
    expect(create.mock.calls[0]![0].email).toBe("eva@example.com")
  })
  it("omits anything that isn't an email", async () => {
    await makeProvider().initiatePayment({
      amount: 10,
      currency_code: "czk",
      data: { email: 5 },
    } as never)
    expect(create.mock.calls[0]![0].email).toBeUndefined()
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
  it("a pending bank transfer is pending_authorization, so Medusa creates the order", async () => {
    status.mockResolvedValue({ code: 0, status: "PENDING", method: "BANK_CZ_RB" })
    const res = await makeProvider().authorizePayment({ data: { transId: "T1" } } as never)
    expect(res.status).toBe("pending_authorization")
    expect(res.data).toMatchObject({ status: "PENDING", method: "BANK_CZ_RB" })
  })
  it("a pending card payment stays pending (no order)", async () => {
    status.mockResolvedValue({ code: 0, status: "PENDING", method: "CARD_CZ_CSOB_2" })
    const res = await makeProvider().authorizePayment({ data: { transId: "T1" } } as never)
    expect(res.status).toBe("pending")
  })
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

// deletePayment runs when the storefront replaces a session (a retry after a cancelled or
// abandoned gateway visit). The old Comgate tx must not stay payable behind a deleted session.
describe("deletePayment", () => {
  it("cancels a still-pending tx at Comgate", async () => {
    status.mockResolvedValue({ code: 0, status: "PENDING" })
    cancel.mockResolvedValue({ code: 0, message: "OK" })
    await makeProvider().deletePayment({ data: { transId: "T1" } } as never)
    expect(cancel).toHaveBeenCalledWith("T1")
  })
  it("leaves an already cancelled tx alone", async () => {
    status.mockResolvedValue({ code: 0, status: "CANCELLED" })
    await makeProvider().deletePayment({ data: { transId: "T1" } } as never)
    expect(cancel).not.toHaveBeenCalled()
  })
  it("refuses to delete a session whose tx is already paid", async () => {
    status.mockResolvedValue({ code: 0, status: "PAID" })
    await expect(
      makeProvider().deletePayment({ data: { transId: "T1" } } as never)
    ).rejects.toThrow(/PAID/)
    expect(cancel).not.toHaveBeenCalled()
  })
  it("refuses when the tx gets paid between the status check and the cancel", async () => {
    status.mockResolvedValue({ code: 0, status: "PENDING" })
    cancel.mockRejectedValue(new Error("Comgate code 1400"))
    await expect(
      makeProvider().deletePayment({ data: { transId: "T1" } } as never)
    ).rejects.toThrow()
  })
  it("is a no-op without a transId", async () => {
    await makeProvider().deletePayment({ data: {} } as never)
    expect(status).not.toHaveBeenCalled()
  })
})

describe("updatePayment", () => {
  it("re-creates the tx when amount changes pre-redirect", async () => {
    create.mockResolvedValue({ code: 0, message: "OK", transId: "T2", redirect: "https://pay/T2" })
    const res = await makeProvider().updatePayment({
      amount: 20,
      currency_code: "czk",
      data: { transId: "T1", session_id: "ps_1" },
    } as never)
    expect(res.data?.transId).toBe("T2")
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ price: 2000 }))
  })
})

describe("getWebhookActionAndData", () => {
  it("re-queries status (never trusts the payload) and maps PAID → captured", async () => {
    status.mockResolvedValue({ code: 0, status: "PAID", price: 1000, refId: "ps_1" })
    const res = await makeProvider().getWebhookActionAndData({
      data: { transId: "T1", refId: "ps_1", status: "PAID" },
      rawData: "",
      headers: {},
    } as never)
    expect(res.action).toBe(PaymentActions.SUCCESSFUL) // "captured"
    expect(res.data).toMatchObject({ session_id: "ps_1" })
  })
  // Codex security sweep 2026-11-04: refId in the webhook body is unsigned. The session must come
  // from Comgate's authenticated status response, never from the payload.
  it("takes the session from the authenticated status, not the payload refId", async () => {
    status.mockResolvedValue({ code: 0, status: "PAID", price: 1000, refId: "ps_real" })
    const res = await makeProvider().getWebhookActionAndData({
      data: { transId: "T1", refId: "ps_other" },
      rawData: "",
      headers: {},
    } as never)
    expect(res.action).toBe(PaymentActions.NOT_SUPPORTED)
  })

  it("uses the authenticated refId when the payload omits it", async () => {
    status.mockResolvedValue({ code: 0, status: "PAID", price: 1000, refId: "ps_real" })
    const res = await makeProvider().getWebhookActionAndData({
      data: { transId: "T1" },
      rawData: "",
      headers: {},
    } as never)
    expect(res.data).toMatchObject({ session_id: "ps_real" })
  })

  it("maps CANCELLED → canceled", async () => {
    status.mockResolvedValue({ code: 0, status: "CANCELLED", price: 1000, refId: "ps_1" })
    const res = await makeProvider().getWebhookActionAndData({
      data: { transId: "T1", refId: "ps_1" },
      rawData: "",
      headers: {},
    } as never)
    expect(res.action).toBe(PaymentActions.CANCELED)
  })
})
