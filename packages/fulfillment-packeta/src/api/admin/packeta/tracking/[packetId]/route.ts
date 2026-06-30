import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type PacketaProviderService from "../../../../../providers/packeta/service.js"

// Container key for the registered Packeta fulfillment provider:
// `fp_${identifier}_${id}` where identifier="packeta" (service) and id="packeta"
// (the documented registration id in medusa-config). The provider holds the
// server-side configured credentials — the API password is never taken from the
// request.
const PACKETA_PROVIDER_KEY = "fp_packeta_packeta"

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const packetId = req.params.packetId!
  const provider = req.scope.resolve<PacketaProviderService>(PACKETA_PROVIDER_KEY)
  const { status, tracking } = await provider.getTracking(packetId)
  res.json({ status, tracking })
}
