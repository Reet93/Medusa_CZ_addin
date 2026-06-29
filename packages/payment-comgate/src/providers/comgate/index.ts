import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import ComgateProviderService from "../../services/comgate-provider.js"

export default ModuleProvider(Modules.PAYMENT, {
  services: [ComgateProviderService],
})
