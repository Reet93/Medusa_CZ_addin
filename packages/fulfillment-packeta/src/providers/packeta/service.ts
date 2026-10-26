import { AbstractFulfillmentProviderService, MedusaError } from "@medusajs/framework/utils"
import { PacketaClient } from "../../core/packeta-client.js"
import { calculateShippingPrice } from "../../core/pricing.js"
import { validatePoint } from "../../core/widget-validate.js"
import { eveningCarrierFor, normalizeZip, splitStreet } from "../../core/door-address.js"
import type { PacketaDelivery, PacketaOptions, PacketaPointData, PriceTable } from "../../types.js"

const HOME_OPTION_ID = "packeta-home"
const EVENING_OPTION_ID = "packeta-evening"
const HOME_CARRIER_ID = "106" // CZ Zásilkovna domů HD

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

  // Packeta's price bands and createPacket work in kilograms; Medusa leaves the unit to the shop.
  private itemsWeightKg_(
    items: Array<Record<string, any>>,
    orderItems: Array<Record<string, any>> = []
  ): number {
    const byId = new Map(orderItems.map((i) => [i?.id, i]))
    const total = items.reduce((sum, it) => {
      // Medusa's fulfillment items carry only line_item_id; the variant is on the order item.
      const variant = it?.variant ?? byId.get(it?.line_item_id)?.variant
      return (
        sum + (Number(variant?.weight ?? it?.weight ?? 0) || 0) * (Number(it?.quantity ?? 1) || 0)
      )
    }, 0)
    return this.options_.weightUnit === "g" ? total / 1000 : total
  }

  private get optionId_(): string {
    return this.options_.optionId ?? "packeta-pickup"
  }

  async getFulfillmentOptions(): Promise<Array<{ id: string; name: string }>> {
    const { homeDelivery, eveningDelivery } = this.options_
    return [
      { id: this.optionId_, name: this.options_.optionName ?? "Packeta pickup point" },
      ...(homeDelivery
        ? [{ id: HOME_OPTION_ID, name: homeDelivery.name ?? "Packeta home delivery" }]
        : []),
      ...(eveningDelivery
        ? [{ id: EVENING_OPTION_ID, name: eveningDelivery.name ?? "Packeta evening delivery" }]
        : []),
    ]
  }

  // The shipping option's data is the fulfillment option it was created from. Options created
  // before home delivery existed carry no id (or the configured pickup id): the pickup point.
  private deliveryOf_(optionData: Record<string, unknown> | undefined): PacketaDelivery {
    const id = optionData?.id
    if (id === HOME_OPTION_ID && this.options_.homeDelivery) {
      return "home"
    }
    if (id === EVENING_OPTION_ID && this.options_.eveningDelivery) {
      return "evening"
    }
    return "pickup"
  }

  private priceTable_(delivery: PacketaDelivery): PriceTable {
    if (delivery === "home") {
      return this.options_.homeDelivery!.priceTable
    }
    if (delivery === "evening") {
      return this.options_.eveningDelivery!.priceTable
    }
    return this.options_.priceTable
  }

  // Door delivery: Packeta needs a street with a house number, a Czech postcode and a phone for
  // the courier. Checked when the customer picks the option, so the order never reaches Admin
  // with an address Packeta will refuse. Returns the carrier for this address.
  private doorCarrier_(delivery: "home" | "evening", address: Record<string, any>): string {
    const invalid = (message: string) =>
      new MedusaError(MedusaError.Types.INVALID_DATA, `Packeta: ${message}`)
    if (!splitStreet(String(address.address_1 ?? ""))) {
      throw invalid("delivery to the door needs a street with a house number")
    }
    const zip = normalizeZip(address.postal_code)
    if (!/^\d{5}$/.test(zip)) {
      throw invalid("delivery to the door needs a 5-digit postcode")
    }
    if (!String(address.city ?? "").trim()) {
      throw invalid("delivery to the door needs a city")
    }
    if (!String(address.phone ?? "").trim()) {
      throw invalid("delivery to the door needs a phone number for the courier")
    }
    if (delivery === "home") {
      return this.options_.homeDelivery!.carrierId ?? HOME_CARRIER_ID
    }
    const carrier = eveningCarrierFor(zip, this.options_.eveningDelivery!.carriers)
    if (!carrier) {
      throw invalid(`evening delivery is not available for postcode ${zip}`)
    }
    return carrier
  }

  async canCalculate(_data: unknown): Promise<boolean> {
    return true
  }

  async calculatePrice(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<{ calculated_amount: number; is_calculated_price_tax_inclusive: boolean }> {
    const countryCode = (context.shipping_address as Record<string, unknown> | undefined)
      ?.country_code as string | undefined
    let country: string
    if (countryCode) {
      country = countryCode
    } else if (!this.options_.defaultCurrency || this.options_.defaultCurrency === "CZK") {
      // "CZK" (or unset, since "CZK" is the documented default) is the one
      // unambiguous currency→country mapping for this provider's PriceTable.
      country = "cz"
    } else {
      throw new Error(
        'Packeta: cannot determine shipping country — set context.shipping_address.country_code, or configure defaultCurrency: "CZK"'
      )
    }
    const items = (context.items as Array<Record<string, any>> | undefined) ?? []
    const weight = this.itemsWeightKg_(items)
    const subtotal = Number((context.item_total as number) ?? (context.subtotal as number) ?? 0)
    const amount = calculateShippingPrice(
      this.priceTable_(this.deliveryOf_(optionData)),
      country,
      weight,
      {
        cod: !!data?.cod,
        subtotal: subtotal || undefined,
      }
    )
    return { calculated_amount: amount, is_calculated_price_tax_inclusive: false }
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const delivery = this.deliveryOf_(optionData)
    if (delivery !== "pickup") {
      const address = (context?.shipping_address ?? {}) as Record<string, any>
      return { delivery, carrier_id: this.doorCarrier_(delivery, address) }
    }
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
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Packeta: invalid pickup point — ${errors.join(", ") || "validation failed"}`
        )
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
    const delivery = data.delivery === "home" || data.delivery === "evening" ? data.delivery : null
    // The address may have been edited since checkout, so the carrier and fields come from the
    // order's address now; doorCarrier_ refuses one Packeta would not deliver to.
    const door = delivery
      ? (() => {
          const { street, houseNumber } = splitStreet(String(addr.address_1 ?? "")) ?? {
            street: String(addr.address_1 ?? ""),
            houseNumber: undefined,
          }
          return {
            addressId: this.doorCarrier_(delivery, addr),
            street,
            houseNumber,
            city: String(addr.city ?? ""),
            zip: normalizeZip(addr.postal_code),
          }
        })()
      : null
    const weight = this.itemsWeightKg_(items, (order?.items as Array<Record<string, any>>) ?? [])
    const cod = data.cod ? Number(data.cod_amount ?? order?.item_total ?? 0) : undefined

    // A MedusaError keeps Packeta's reason visible in the admin (a plain Error is "unknown error").
    const result = await this.client_
      .createPacket({
        number: String(order?.display_id ?? order?.id ?? ""),
        name: String(addr.first_name ?? ""),
        surname: String(addr.last_name ?? ""),
        email: order?.email ? String(order.email) : undefined,
        phone: addr.phone ? String(addr.phone) : undefined,
        ...(door ?? {
          addressId: isExternal
            ? String(data.carrier_id ?? data.pickup_point_id)
            : String(data.pickup_point_id),
          carrierPickupPoint: isExternal ? String(data.carrier_pickup_point_id ?? "") : undefined,
        }),
        value: Number(order?.item_total ?? 0),
        weight,
        ...(cod != null ? { cod, currency: this.options_.defaultCurrency ?? "CZK" } : {}),
        eshop: this.options_.eshop,
      })
      .catch((e: Error) => {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Packeta: ${e.message}`)
      })

    return {
      data: { ...data, packet_id: result.id, barcode: result.barcode },
      labels: [],
    }
  }

  /**
   * Status + tracking history for a packet, using the server-side configured
   * credentials. Backs the admin tracking route so the API password is never
   * accepted from (or exposed in) the request.
   */
  async getTracking(packetId: string): Promise<{
    status: { statusCode: string; statusText: string }
    tracking: Array<{ statusCode: string; statusText: string; dateTime?: string }>
  }> {
    const [status, tracking] = await Promise.all([
      this.client_.packetStatus(packetId),
      this.client_.packetTracking(packetId),
    ])
    return { status, tracking }
  }

  /**
   * Close a batch (create a shipment) for the given packet ids, using the
   * server-side configured credentials. Backs the admin close-batch route.
   */
  async closeBatch(packetIds: string[]): Promise<{ shipment: { id: string; barcode: string } }> {
    const shipment = await this.client_.createShipment(packetIds.map(String))
    return { shipment }
  }

  async cancelFulfillment(data: Record<string, unknown>): Promise<void> {
    const packetId = data.packet_id as string | undefined
    if (packetId) {
      await this.client_.cancelPacket(packetId)
    }
  }

  // Medusa's fulfillment module strips the order before calling createReturn, so the customer
  // email, phone and value that Packeta's ClaimWithPasswordAttributes require never reach a
  // provider. Sending an incomplete claim only fails later at Packeta; refuse clearly instead.
  // Create return codes in the app, where the order is available: subscribe to
  // order.return_requested and call PacketaClient.createPacketClaim (see README "Returns").
  async createReturnFulfillment(
    _fulfillment: Record<string, any>
  ): Promise<{ data: Record<string, unknown>; labels: never[] }> {
    throw new Error(
      "Packeta: return codes are not created through the fulfillment provider (Medusa does not " +
        "pass the order's email/phone/value to it). Use a manual return shipping option and create " +
        "the code from an order.return_requested subscriber with PacketaClient.createPacketClaim."
    )
  }

  private async labelDocuments(
    data: Record<string, unknown>
  ): Promise<Array<{ type: string; base64: string; mime: string }>> {
    const packetId = data.packet_id as string | undefined
    if (!packetId) {
      return []
    }
    const base64 = await this.client_.packetLabelPdf(
      packetId,
      this.options_.labelFormat ?? "A6 on A4"
    )
    return [{ type: "label", base64, mime: "application/pdf" }]
  }

  async getShipmentDocuments(data: Record<string, unknown>): Promise<any> {
    return this.labelDocuments(data)
  }

  async retrieveDocuments(
    fulfillmentData: Record<string, unknown>,
    _documentType: string
  ): Promise<any> {
    return this.labelDocuments(fulfillmentData)
  }
}

export default PacketaProviderService
