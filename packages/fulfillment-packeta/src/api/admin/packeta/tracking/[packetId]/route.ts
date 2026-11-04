import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { configuredPacketaProvider } from "../../provider.js"

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const packetId = req.params.packetId!
  const provider = configuredPacketaProvider(req)
  if (!provider) {
    res.status(503).json({ message: "Packeta is not configured" })
    return
  }
  const { status, tracking } = await provider.getTracking(packetId)
  res.json({ status, tracking })
}
