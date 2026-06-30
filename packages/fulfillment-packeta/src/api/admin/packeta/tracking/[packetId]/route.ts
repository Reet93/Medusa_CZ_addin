import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PacketaClient } from "../../../../../core/packeta-client.js"

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const packetId = req.params.packetId!
  const apiPassword = (req.query.apiPassword as string) || ""
  if (!apiPassword) {
    res.status(400).json({ message: "apiPassword query param is required" })
    return
  }
  const client = new PacketaClient({ apiPassword })
  const [status, tracking] = await Promise.all([
    client.packetStatus(packetId),
    client.packetTracking(packetId),
  ])
  res.json({ status, tracking })
}
