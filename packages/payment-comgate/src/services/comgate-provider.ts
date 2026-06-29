import { AbstractPaymentProvider, BigNumber, PaymentSessionStatus } from "@medusajs/framework/utils"
import { ComgateClient, toMinorUnits } from "../core/comgate-client"
import type { ComgateOptions, ComgateSessionData, ComgateStatus } from "../types"

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

  // --- remaining methods still throw until later tasks ---
  private notImplemented(m: string): never {
    throw new Error(`ComgateProviderService.${m} not implemented`)
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
  async refundPayment(): Promise<never> {
    return this.notImplemented("refundPayment")
  }
  async cancelPayment(): Promise<never> {
    return this.notImplemented("cancelPayment")
  }
  async deletePayment(): Promise<never> {
    return this.notImplemented("deletePayment")
  }
  async updatePayment(): Promise<never> {
    return this.notImplemented("updatePayment")
  }
  async getWebhookActionAndData(): Promise<never> {
    return this.notImplemented("getWebhookActionAndData")
  }
}

export default ComgateProviderService
