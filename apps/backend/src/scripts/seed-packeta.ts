import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

export default async function seedPacketa({ container }: ExecArgs) {
  const logger = container.resolve("logger")
  const region = container.resolve(Modules.REGION)
  const fulfillment = container.resolve(Modules.FULFILLMENT)

  const regions = await region.listRegions({ name: "Czechia" })
  if (!regions.length) {
    await region.createRegions([{ name: "Czechia", currency_code: "czk", countries: ["cz"] }])
    logger.info("Created Czechia (CZK) region.")
  } else {
    logger.info("Czechia region already exists; skipping region create.")
  }

  // Fulfillment set + service zone + calculated shipping option bound to the packeta provider.
  const existingSets = await fulfillment.listFulfillmentSets({ name: "packeta-set" })
  if (existingSets.length) {
    logger.info("packeta-set already exists; skipping fulfillment seed.")
    return
  }
  const set = await fulfillment.createFulfillmentSets({
    name: "packeta-set",
    type: "shipping",
    service_zones: [{ name: "CZ", geo_zones: [{ type: "country", country_code: "cz" }] }],
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
}
