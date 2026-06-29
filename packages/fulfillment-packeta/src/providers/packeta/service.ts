import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils"
import { PacketaClient } from "../../core/packeta-client.js"
import { calculateShippingPrice } from "../../core/pricing.js"
import { validatePoint } from "../../core/widget-validate.js"
import type { PacketaOptions, PacketaPointData } from "../../types.js"

class PacketaProviderService extends AbstractFulfillmentProviderService {
  static identifier = "packeta"

  protected options_: PacketaOptions
  protected client_: PacketaClient

  static validateOptions(options: Record<string, unknown>): void {
    if (!options.apiKey) {
      throw new Error("Packeta provider requires an `apiKey` option")
    }
    if (!options.apiPassword) {
      throw new Error("Packeta provider requires an `apiPassword` option")
    }
  }

  constructor(_container: Record<string, unknown>, options: PacketaOptions) {
    super()
    this.options_ = options
    this.client_ = new PacketaClient({ apiPassword: options.apiPassword })
  }

  private get optionId_(): string {
    return this.options_.optionId ?? "packeta-pickup"
  }

  async getFulfillmentOptions(): Promise<Array<{ id: string; name: string }>> {
    return [{ id: this.optionId_, name: this.options_.optionName ?? "Packeta pickup point" }]
  }

  async canCalculate(_data: unknown): Promise<boolean> {
    return true
  }

  async calculatePrice(
    _optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<{ calculated_amount: number; is_calculated_price_tax_inclusive: boolean }> {
    const country =
      ((context.shipping_address as Record<string, unknown> | undefined)?.country_code as string) ??
      (this.options_.defaultCurrency === "CZK" ? "cz" : "cz")
    const items = (context.items as Array<Record<string, any>> | undefined) ?? []
    const weight = items.reduce(
      (sum, it) =>
        sum + (Number(it?.variant?.weight ?? it?.weight ?? 0) || 0) * (it?.quantity ?? 1),
      0
    )
    const subtotal = Number((context.item_total as number) ?? (context.subtotal as number) ?? 0)
    const amount = calculateShippingPrice(this.options_.priceTable, country, weight, {
      cod: !!data.cod,
      subtotal: subtotal || undefined,
    })
    return { calculated_amount: amount, is_calculated_price_tax_inclusive: false }
  }
}

export default PacketaProviderService
