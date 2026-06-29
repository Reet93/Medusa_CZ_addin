import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import PacketaProviderService from "./service.js"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [PacketaProviderService],
})
