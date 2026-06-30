import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PacketaClient } from "../../../../core/packeta-client.js"

interface CloseBatchBody {
  apiPassword: string
  packetIds: string[]
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { apiPassword, packetIds } = req.body as CloseBatchBody
  if (!apiPassword || !packetIds?.length) {
    res.status(400).json({ message: "apiPassword and packetIds[] are required" })
    return
  }
  const client = new PacketaClient({ apiPassword })
  const shipment = await client.createShipment(packetIds.map(String))
  res.json({ shipment })
}
