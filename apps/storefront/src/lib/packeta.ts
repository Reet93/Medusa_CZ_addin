const LIBRARY_URL = "https://widget.packeta.com/v6/www/js/library.js"

export interface PacketaPoint {
  id: string
  name?: string
  street?: string
  city?: string
  zip?: string
  country?: string
  pickupPointType?: "internal" | "external"
  carrierId?: string
  carrierPickupPointId?: string
}

interface PacketaGlobal {
  Widget: {
    pick: (
      apiKey: string,
      cb: (point: PacketaPoint | null) => void,
      options?: Record<string, unknown>
    ) => void
    close: () => void
  }
}

declare global {
  interface Window {
    Packeta?: PacketaGlobal
  }
}

let loading: Promise<void> | null = null

export function loadPacketaWidget(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Packeta widget can only load in the browser"))
  }
  if (window.Packeta) {
    return Promise.resolve()
  }
  if (loading) {
    return loading
  }
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = LIBRARY_URL
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error("Failed to load Packeta widget library"))
    document.head.appendChild(script)
  })
  return loading
}

export async function pickPacketaPoint(
  apiKey: string,
  options: Record<string, unknown> = { country: "cz", language: "cs" }
): Promise<PacketaPoint | null> {
  await loadPacketaWidget()
  return new Promise((resolve) => {
    window.Packeta!.Widget.pick(apiKey, (point) => resolve(point), options)
  })
}
