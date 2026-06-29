import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

export default async function seedComgateRegion({ container }: ExecArgs) {
  const regionService = container.resolve(Modules.REGION)
  const existing = await regionService.listRegions({ name: "Czechia" })
  if (existing.length) {
    console.log("Czechia region already exists; skipping.")
    return
  }
  await regionService.createRegions([
    {
      name: "Czechia",
      currency_code: "czk",
      countries: ["cz"],
      payment_providers: ["pp_comgate_comgate"],
    },
  ])
  console.log("Created Czechia (CZK) region with Comgate enabled.")
}
