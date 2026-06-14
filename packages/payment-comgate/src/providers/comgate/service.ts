import { AbstractPaymentProvider } from "@medusajs/framework/utils"

/**
 * Comgate payment provider — SKELETON (M0). No business logic yet.
 * Real method bodies land in M1. Signatures verified against Medusa 2.15
 * (docs/superpowers/research/2026-06-14-medusa-2.15-verification.md §3).
 */
class ComgateProviderService extends AbstractPaymentProvider {
  static identifier = "comgate"

  // Public constructor is required so the class satisfies `Constructor<any>` in
  // ModuleProvider's `services` array — AbstractPaymentProvider declares a *protected*
  // constructor, which a direct subclass inherits as protected and cannot be registered.
  // Matches the official @medusajs/payment-stripe concrete provider pattern.
  constructor(container: Record<string, unknown>, options?: Record<string, unknown>) {
    super(container, options)
  }

  private notImplemented(method: string): never {
    throw new Error(`ComgateProviderService.${method} not implemented (M0 skeleton)`)
  }

  async initiatePayment(): Promise<any> {
    return this.notImplemented("initiatePayment")
  }
  async authorizePayment(): Promise<any> {
    return this.notImplemented("authorizePayment")
  }
  async capturePayment(): Promise<any> {
    return this.notImplemented("capturePayment")
  }
  async refundPayment(): Promise<any> {
    return this.notImplemented("refundPayment")
  }
  async cancelPayment(): Promise<any> {
    return this.notImplemented("cancelPayment")
  }
  async deletePayment(): Promise<any> {
    return this.notImplemented("deletePayment")
  }
  async getPaymentStatus(): Promise<any> {
    return this.notImplemented("getPaymentStatus")
  }
  async retrievePayment(): Promise<any> {
    return this.notImplemented("retrievePayment")
  }
  async updatePayment(): Promise<any> {
    return this.notImplemented("updatePayment")
  }
  async getWebhookActionAndData(): Promise<any> {
    return this.notImplemented("getWebhookActionAndData")
  }
}

export default ComgateProviderService
