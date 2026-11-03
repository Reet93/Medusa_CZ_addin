import type { ModuleProviderExports } from "@medusajs/framework/types"
import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import ComgateProviderService from "../../services/comgate-provider.js"

// Annotated: the inferred type names a pnpm-internal @medusajs/types path (TS2742).
const provider: ModuleProviderExports = ModuleProvider(Modules.PAYMENT, {
  services: [ComgateProviderService],
})

export default provider
