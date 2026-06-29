import type { PriceTable } from "../types.js"

export interface PriceContext {
  /** order is cash-on-delivery */
  cod?: boolean
  /** order subtotal in major units (for free-over-threshold) */
  subtotal?: number
}

export function calculateShippingPrice(
  table: PriceTable,
  country: string,
  weightKg: number,
  ctx: PriceContext
): number {
  const cp = table[country.toLowerCase()]
  if (!cp) {
    throw new Error(`No Packeta price configured for country "${country}"`)
  }
  if (ctx.subtotal != null && cp.freeOver != null && ctx.subtotal >= cp.freeOver) {
    return 0
  }
  const sorted = [...cp.bands].sort((a, b) => a.maxWeight - b.maxWeight)
  const band = sorted.find((b) => weightKg <= b.maxWeight) ?? sorted[sorted.length - 1]!
  let price = band.price
  if (ctx.cod && cp.codSurcharge) {
    price += cp.codSurcharge
  }
  return price
}
