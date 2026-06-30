"use client"

import { useState } from "react"
import { Button } from "@modules/common/components/ui"
import { pickPacketaPoint, type PacketaPoint } from "@lib/packeta"

export default function PacketaPickupPoint({
  value,
  onChange,
}: {
  value: PacketaPoint | null
  onChange: (point: PacketaPoint) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const apiKey = process.env.NEXT_PUBLIC_PACKETA_API_KEY as string

  const open = async () => {
    setError(null)
    setOpening(true)
    try {
      const point = await pickPacketaPoint(apiKey)
      if (point) {
        onChange(point)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="flex flex-col gap-y-2" data-testid="packeta-pickup-point">
      <Button variant="secondary" onClick={open} isLoading={opening} type="button">
        {value ? "Change pickup point" : "Choose pickup point"}
      </Button>
      {value && (
        <div className="text-small-regular text-ui-fg-subtle" data-testid="packeta-selected-point">
          {value.name ?? value.id}
          {value.city ? `, ${value.city}` : ""}
        </div>
      )}
      {error && (
        <div className="text-small-regular text-ui-fg-error" data-testid="packeta-point-error">
          {error}
        </div>
      )}
    </div>
  )
}
