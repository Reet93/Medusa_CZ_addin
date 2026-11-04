import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type PacketaProviderService from "../../../../../providers/packeta/service.js"

// Same registered provider as the tracking route; it holds the server-side credentials.
const PACKETA_PROVIDER_KEY = "fp_packeta_packeta"

// The packet's label as a PDF, for the order widget's "print label" link. Admin routes require
// an authenticated admin user.
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const packetId = req.params.packetId ?? ""
  if (!/^\d+$/.test(packetId)) {
    res.status(400).json({ message: "Invalid packet id" })
    return
  }
  const provider = req.scope.resolve<PacketaProviderService>(PACKETA_PROVIDER_KEY)
  const [label] = await provider.getShipmentDocuments({ packet_id: packetId })
  if (!label) {
    res.status(404).json({ message: "No label for this packet" })
    return
  }
  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `inline; filename="packeta-${packetId}.pdf"`)
  res.send(Buffer.from(label.base64, "base64"))
}
