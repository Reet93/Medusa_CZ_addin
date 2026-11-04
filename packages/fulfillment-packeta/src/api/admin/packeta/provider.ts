import type { MedusaRequest } from "@medusajs/framework/http"
import { packetaProviderOptions } from "../../../core/configured-provider.js"
import PacketaProviderService from "../../../providers/packeta/service.js"

// Module providers are registered in the fulfillment module's own container, so a route cannot
// resolve "fp_packeta_packeta" (live 2026-11-04). Build one from the configured options; it holds
// the server-side credentials, never anything from the request.
export function configuredPacketaProvider(req: MedusaRequest): PacketaProviderService | null {
  const options = packetaProviderOptions(req.scope.resolve("configModule"))
  return options ? new PacketaProviderService({} as never, options) : null
}
