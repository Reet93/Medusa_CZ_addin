import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

// EUR→CZK factor used to derive placeholder CZK prices for the demo catalogue
// (the base seed prices products in EUR/USD only). Not an FX-accurate rate —
// just enough to make the Czech region purchasable.
const CZK_RATE = 25

export default async function seedPacketa({ container }: ExecArgs) {
  const logger = container.resolve("logger")
  const region = container.resolve(Modules.REGION)
  const fulfillment = container.resolve(Modules.FULFILLMENT)
  const stockLocation = container.resolve(Modules.STOCK_LOCATION)
  const pricing = container.resolve(Modules.PRICING)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)

  // 1. Czechia (CZK) region ---------------------------------------------------
  const regions = await region.listRegions({ name: "Czechia" })
  if (!regions.length) {
    await region.createRegions([
      { name: "Czechia", currency_code: "czk", countries: ["cz"] },
    ])
    logger.info("Created Czechia (CZK) region.")
  } else {
    logger.info("Czechia region already exists; skipping region create.")
  }

  // 2. Packeta fulfillment set + calculated shipping option -------------------
  let set = (await fulfillment.listFulfillmentSets({ name: "packeta-set" }))[0]
  if (!set) {
    set = await fulfillment.createFulfillmentSets({
      name: "packeta-set",
      type: "shipping",
      service_zones: [
        { name: "CZ", geo_zones: [{ type: "country", country_code: "cz" }] },
      ],
    })
    await fulfillment.createShippingOptions([
      {
        name: "Packeta pickup point",
        service_zone_id: set.service_zones[0].id,
        shipping_profile_id: (await fulfillment.listShippingProfiles({}))[0]?.id,
        // Provider id is `{identifier}_{id}` = "packeta_packeta" (the service's static
        // identifier "packeta" + the medusa-config registration id "packeta").
        // Confirmed against the live fulfillment_provider table on the server.
        provider_id: "packeta_packeta",
        price_type: "calculated",
        type: { label: "Packeta", description: "Pickup point", code: "packeta" },
        data: { id: "packeta-pickup" },
      },
    ])
    logger.info("Created Packeta service zone + calculated shipping option.")
  } else {
    logger.info("packeta-set already exists; skipping fulfillment create.")
  }

  // 3. Link the Packeta set + provider to every stock location ----------------
  // A shipping option only appears at checkout when its fulfillment set's
  // location serves the cart's sales channel AND its provider is enabled at that
  // location. The base seed only links `manual_manual` + the standard set, so
  // without these two links the Packeta option never shows.
  const { data: locations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "fulfillment_sets.id", "fulfillment_providers.id"],
  })
  for (const loc of locations) {
    const hasSet = (loc.fulfillment_sets ?? []).some(
      (s) => s?.id === set.id
    )
    if (!hasSet) {
      await link.create({
        [Modules.STOCK_LOCATION]: { stock_location_id: loc.id },
        [Modules.FULFILLMENT]: { fulfillment_set_id: set.id },
      })
      logger.info(`Linked packeta-set to stock location ${loc.id}.`)
    }
    const hasProvider = (loc.fulfillment_providers ?? []).some(
      (p) => p?.id === "packeta_packeta"
    )
    if (!hasProvider) {
      await link.create({
        [Modules.STOCK_LOCATION]: { stock_location_id: loc.id },
        [Modules.FULFILLMENT]: { fulfillment_provider_id: "packeta_packeta" },
      })
      logger.info(`Enabled packeta_packeta at stock location ${loc.id}.`)
    }
  }

  // 4. CZK prices for the demo catalogue --------------------------------------
  // The base seed prices variants in EUR/USD only, so the CZK region renders
  // everything as out-of-stock (calculated_price === null). Derive a CZK price
  // from each variant's default EUR price.
  const { data: variants } = await query.graph({
    entity: "product_variant",
    fields: [
      "id",
      "price_set.id",
      "price_set.prices.currency_code",
      "price_set.prices.amount",
      "price_set.prices.rules_count",
    ],
  })
  let priced = 0
  for (const v of variants) {
    const priceSet = v.price_set as
      | {
          id: string
          prices?: {
            currency_code: string
            amount: number
            rules_count?: number
          }[]
        }
      | undefined
    if (!priceSet?.id) {
      continue
    }
    const prices = priceSet.prices ?? []
    if (prices.some((p) => p.currency_code === "czk")) {
      continue
    }
    const eur =
      prices.find(
        (p) => p.currency_code === "eur" && (p.rules_count ?? 0) === 0
      ) ?? prices.find((p) => p.currency_code === "eur")
    if (eur?.amount == null) {
      continue
    }
    await pricing.addPrices({
      priceSetId: priceSet.id,
      prices: [
        { amount: Math.round(eur.amount * CZK_RATE), currency_code: "czk" },
      ],
    })
    priced++
  }
  logger.info(`Added CZK prices to ${priced} variant(s).`)
}
