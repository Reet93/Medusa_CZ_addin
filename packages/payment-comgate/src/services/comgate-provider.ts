import {
  AbstractPaymentProvider,
  BigNumber,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import { ComgateClient, toMinorUnits } from "../core/comgate-client.js"
import type { ComgateOptions, ComgateSessionData, ComgateStatus } from "../types.js"

class ComgateProviderService extends AbstractPaymentProvider<ComgateOptions> {
  static identifier = "comgate"

  protected client_: ComgateClient
  protected options_: ComgateOptions

  static validateOptions(options: Record<string, unknown>): void {
    if (!options.merchant || !options.secret) {
      throw new Error("Comgate provider requires `merchant` and `secret` options")
    }
  }

  constructor(container: Record<string, unknown>, options: ComgateOptions) {
    super(container, options)
    this.options_ = options
    this.client_ = new ComgateClient(options)
  }

  private get capture_(): "automatic" | "manual" {
    return this.options_.capture ?? "automatic"
  }

  private num(amount: unknown): number {
    return new BigNumber(amount as never).numeric
  }

  private mapStatus(cg: ComgateStatus): PaymentSessionStatus {
    switch (cg) {
      case "PAID":
        return this.capture_ === "manual"
          ? PaymentSessionStatus.AUTHORIZED
          : PaymentSessionStatus.CAPTURED
      case "AUTHORIZED":
        return PaymentSessionStatus.AUTHORIZED
      case "CANCELLED":
        return PaymentSessionStatus.CANCELED
      case "PENDING":
      default:
        return PaymentSessionStatus.PENDING
    }
  }

  async initiatePayment(input: {
    amount: unknown
    currency_code: string
    data?: Record<string, unknown>
    context?: Record<string, unknown>
  }): Promise<{ id: string; data: Record<string, unknown> }> {
    const refId =
      (input.data?.session_id as string) ??
      (input.context?.idempotency_key as string) ??
      `cart-${Date.now()}`
    const res = await this.client_.create({
      price: toMinorUnits(this.num(input.amount)),
      curr: input.currency_code.toUpperCase(),
      label: `Order ${refId}`.slice(0, 16),
      refId,
      prepareOnly: true,
      preauth: this.capture_ === "manual",
      method: this.options_.method ?? "ALL",
      country: this.options_.country ?? "CZ",
    })
    const data: ComgateSessionData = { transId: res.transId, redirect_url: res.redirect }
    return { id: res.transId, data }
  }

  async getPaymentStatus(input: {
    data?: Record<string, unknown>
  }): Promise<{ status: PaymentSessionStatus; data?: Record<string, unknown> }> {
    const transId = input.data?.transId as string
    const res = await this.client_.status(transId)
    return { status: this.mapStatus(res.status), data: { ...input.data, status: res.status } }
  }

  async retrievePayment(input: {
    data?: Record<string, unknown>
  }): Promise<{ data?: Record<string, unknown> }> {
    const transId = input.data?.transId as string
    const res = await this.client_.status(transId)
    return { data: { ...input.data, ...res } }
  }

  async authorizePayment(input: {
    data?: Record<string, unknown>
  }): Promise<{ status: PaymentSessionStatus; data?: Record<string, unknown> }> {
    const transId = input.data?.transId as string
    const res = await this.client_.status(transId)
    return { status: this.mapStatus(res.status), data: { ...input.data, status: res.status } }
  }

  async capturePayment(input: {
    amount?: unknown
    data?: Record<string, unknown>
  }): Promise<{ data?: Record<string, unknown> }> {
    if (this.capture_ === "manual") {
      const transId = input.data?.transId as string
      const amount = input.amount != null ? toMinorUnits(this.num(input.amount)) : undefined
      await this.client_.capturePreauth(transId, amount)
    }
    // automatic: Comgate already captured on PAID — nothing to do.
    return { data: { ...input.data, status: "PAID" } }
  }
  async refundPayment(input: {
    amount: unknown
    data?: Record<string, unknown>
  }): Promise<{ data?: Record<string, unknown> }> {
    const transId = input.data?.transId as string
    const curr = (input.data?.curr as string) ?? "CZK"
    await this.client_.refund(transId, toMinorUnits(this.num(input.amount)), curr)
    return { data: input.data }
  }

  private async cancelOrDelete(input: {
    data?: Record<string, unknown>
  }): Promise<{ data?: Record<string, unknown> }> {
    const transId = input.data?.transId as string
    if (this.capture_ === "manual" && input.data?.status === "AUTHORIZED") {
      await this.client_.cancelPreauth(transId)
    }
    // automatic / non-authorized: Comgate has no merchant-side cancel of a
    // redirect tx — best-effort no-op.
    return { data: input.data }
  }
  async cancelPayment(input: { data?: Record<string, unknown> }) {
    return this.cancelOrDelete(input)
  }
  async deletePayment(input: { data?: Record<string, unknown> }) {
    return this.cancelOrDelete(input)
  }
  async updatePayment(input: {
    amount: unknown
    currency_code: string
    data?: Record<string, unknown>
  }): Promise<{ data?: Record<string, unknown> }> {
    // Comgate tx amounts are immutable post-create → re-create for a new amount.
    const init = await this.initiatePayment({
      amount: input.amount,
      currency_code: input.currency_code,
      data: input.data,
    })
    return { data: { ...input.data, ...init.data } }
  }

  async getWebhookActionAndData(payload: {
    data: Record<string, unknown>
    rawData: string | Buffer
    headers: Record<string, unknown>
  }): Promise<{ action: PaymentActions; data?: { session_id: string; amount: number } }> {
    const transId = payload.data.transId as string
    const sessionId = (payload.data.refId as string) ?? transId
    // Unsigned webhook → re-query the real status (verification doc A6).
    const res = await this.client_.status(transId)
    const amount = res.price ?? 0
    let action: PaymentActions
    switch (res.status) {
      case "PAID":
        action = this.capture_ === "manual" ? PaymentActions.AUTHORIZED : PaymentActions.SUCCESSFUL
        break
      case "AUTHORIZED":
        action = PaymentActions.AUTHORIZED
        break
      case "CANCELLED":
        action = PaymentActions.CANCELED
        break
      case "PENDING":
        action = PaymentActions.PENDING
        break
      default:
        action = PaymentActions.NOT_SUPPORTED
    }
    return { action, data: { session_id: sessionId, amount } }
  }
}

export default ComgateProviderService
