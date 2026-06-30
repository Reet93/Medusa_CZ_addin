import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type PacketaProviderService from "../../../../providers/packeta/service.js"

// Container key for the registered Packeta fulfillment provider:
// `fp_${identifier}_${id}` where identifier="packeta" (service) and id="packeta"
// (the documented registration id in medusa-config). The provider holds the
// server-side configured credentials — the API password is never taken from the
// request.
const PACKETA_PROVIDER_KEY = "fp_packeta_packeta"

interface CloseBatchBody {
  packetIds: string[]
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { packetIds } = (req.body ?? {}) as CloseBatchBody
  if (!packetIds?.length) {
    res.status(400).json({ message: "packetIds[] is required" })
    return
  }
  const provider = req.scope.resolve<PacketaProviderService>(PACKETA_PROVIDER_KEY)
  const { shipment } = await provider.closeBatch(packetIds.map(String))
  res.json({ shipment })
}
