import { describe, it, expect } from "vitest"
import { PacketaClient } from "../../core/packeta-client"

const apiPassword = process.env.PACKETA_API_PASSWORD
const eshop = process.env.PACKETA_ESHOP // dedicated TEST sender label
const run = apiPassword && eshop ? describe : describe.skip

run("Packeta live (real endpoint, test sender)", () => {
  const client = new PacketaClient({ apiPassword: apiPassword! })

  it("createPacket → packetStatus → cancelPacket (NEVER createShipment)", async () => {
    const created = await client.createPacket({
      number: `it-${Date.now()}`,
      name: "Test",
      surname: "Sender",
      email: "test@packetatest.com",
      addressId: "79",
      value: 1,
      weight: 1,
      eshop: eshop!,
    })
    expect(created.id).toBeTruthy()
    const status = await client.packetStatus(created.id)
    expect(status.statusCode).toBeTruthy()
    // Clean up — never let a test packet enter the network.
    await client.cancelPacket(created.id)
  })
})
