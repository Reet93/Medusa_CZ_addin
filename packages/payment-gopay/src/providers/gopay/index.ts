import type { ModuleProviderExports } from "@medusajs/framework/types"
import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import GopayProviderService from "./service"

// Annotated: the inferred type names a pnpm-internal @medusajs/types path (TS2742).
const provider: ModuleProviderExports = ModuleProvider(Modules.PAYMENT, {
  services: [GopayProviderService],
})

export default provider
