// REST/XML main API + widget validate endpoints (research §B, §C1).
export const PACKETA_REST_URL = "https://www.zasilkovna.cz/api/rest"
export const PACKETA_WIDGET_VALIDATE_URL =
  "https://widget.packeta.com/v6/pps/api/widget/v1/validate"

export interface PriceBand {
  /** inclusive upper bound, kg */
  maxWeight: number
  /** major units (e.g. CZK) */
  price: number
}
export interface CountryPricing {
  /** ascending by maxWeight; the last band catches anything heavier */
  bands: PriceBand[]
  /** added to the band price when the order is cash-on-delivery */
  codSurcharge?: number
  /** order subtotal ≥ this → shipping is free (price 0) */
  freeOver?: number
}
/** key = ISO-3166-1 alpha-2 lowercase, e.g. "cz" */
export type PriceTable = Record<string, CountryPricing>

export interface PacketaOptions {
  apiKey: string // public — widget + pickup-point REST
  apiPassword: string // secret — main API (server-only)
  eshop?: string // sender indication / test sender
  defaultCurrency?: string // default "CZK"
  priceTable: PriceTable
  validatePointServerSide?: boolean // default true
  labelFormat?: string // default "A6 on A4"
  optionId?: string // shipping option id this provider serves; default "packeta-pickup"
  optionName?: string // default "Packeta pickup point"
}

export type PickupPointType = "internal" | "external"

/** Packet attributes sent to createPacket (research §B1). */
export interface PacketAttributes extends Record<string, unknown> {
  number: string
  name: string
  surname: string
  email?: string
  phone?: string
  addressId: string // internal point id OR external carrierId
  carrierPickupPoint?: string // external carrier's point code
  currency?: string
  cod?: number
  value: number
  weight: number
  eshop?: string
}

export interface PacketIdDetail {
  id: string // 64-bit — keep as string
  barcode: string
}

/** Point fields persisted on the shipping-method `data` (subset of widget Point). */
export interface PacketaPointData extends Record<string, unknown> {
  pickup_point_id: string
  pickup_point_name?: string
  pickup_point_type?: PickupPointType
  carrier_id?: string
  carrier_pickup_point_id?: string
}

/** What we store on the fulfillment `data` after createPacket. */
export interface PacketaFulfillmentData extends PacketaPointData {
  packet_id?: string
  barcode?: string
}
