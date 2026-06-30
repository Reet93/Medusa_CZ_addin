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

  async validateFulfillmentData(
    _optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    _context: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const id = data.pickup_point_id as string | undefined
    if (!id) {
      throw new Error("Packeta: no pickup point selected (missing `pickup_point_id`)")
    }
    const type = (data.pickup_point_type as string) === "external" ? "external" : "internal"
    const normalized: PacketaPointData = {
      pickup_point_id: String(id),
      pickup_point_name: data.pickup_point_name as string | undefined,
      pickup_point_type: type,
      carrier_id: data.carrier_id as string | undefined,
      carrier_pickup_point_id: data.carrier_pickup_point_id as string | undefined,
    }

    if (this.options_.validatePointServerSide !== false) {
      const point =
        type === "external"
          ? {
              carrierId: normalized.carrier_id,
              carrierPickupPointId: normalized.carrier_pickup_point_id,
            }
          : { id: normalized.pickup_point_id }
      const { isValid, errors } = await validatePoint({ apiKey: this.options_.apiKey, point })
      if (!isValid) {
        throw new Error(`Packeta: invalid pickup point — ${errors.join(", ") || "validation failed"}`)
      }
    }
    return normalized
  }

  async createFulfillment(
    data: Record<string, unknown>,
    items: Array<Record<string, any>>,
    order: Record<string, any> | undefined,
    _fulfillment: Record<string, unknown>
  ): Promise<{ data: Record<string, unknown>; labels: never[] }> {
    const addr = (order?.shipping_address ?? {}) as Record<string, any>
    const isExternal = (data.pickup_point_type as string) === "external"
    const weight =
      items.reduce(
        (sum, it) => sum + (Number(it?.variant?.weight ?? it?.weight ?? 0) || 0) * (it?.quantity ?? 1),
        0
      ) || 0
    const cod = data.cod ? Number(data.cod_amount ?? order?.item_total ?? 0) : undefined

    const result = await this.client_.createPacket({
      number: String(order?.display_id ?? order?.id ?? ""),
      name: String(addr.first_name ?? ""),
      surname: String(addr.last_name ?? ""),
      email: order?.email ? String(order.email) : undefined,
      phone: addr.phone ? String(addr.phone) : undefined,
      addressId: isExternal
        ? String(data.carrier_id ?? data.pickup_point_id)
        : String(data.pickup_point_id),
      carrierPickupPoint: isExternal
        ? String(data.carrier_pickup_point_id ?? "")
        : undefined,
      value: Number(order?.item_total ?? 0),
      weight,
      ...(cod != null ? { cod, currency: this.options_.defaultCurrency ?? "CZK" } : {}),
      eshop: this.options_.eshop,
    })

    return {
      data: { ...data, packet_id: result.id, barcode: result.barcode },
      labels: [],
    }
  }

  async cancelFulfillment(data: Record<string, unknown>): Promise<void> {
    const packetId = data.packet_id as string | undefined
    if (packetId) {
      await this.client_.cancelPacket(packetId)
    }
  }
}

export default PacketaProviderService
