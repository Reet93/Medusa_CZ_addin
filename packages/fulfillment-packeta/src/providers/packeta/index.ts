import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import PacketaProviderService from "./service"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [PacketaProviderService],
})
