# Packeta Fulfillment — Storefront Widget v6 (M2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a storefront customer pick a Packeta pickup point during checkout via the Packeta Widget v6, and carry the selected point into the cart's shipping-method `data` so the M2a backend provider can create the packet. Acceptance is a manual demo round-trip.

**Architecture:** A client React component (`packeta-pickup-point`) loads `library.js` and calls `Packeta.Widget.pick(apiKey, callback, options)`. When the customer confirms a point, the callback writes the point's fields (`id`, `name`, `pickupPointType`, external `carrierId`/`carrierPickupPointId`) into the cart shipping method's `data` via the starter's `setShippingMethod`/`addShippingMethod` flow. The checkout delivery step renders this component when the selected shipping option is the Packeta provider; "Continue" is gated until a point is chosen.

**Tech Stack:** Next.js 15 storefront (`apps/storefront`), TypeScript, MedusaJS JS SDK (`@medusajs/js-sdk` store fulfillment), the Packeta Widget v6 browser library.

**Grounding (verified — do not re-derive from memory):**

- Packeta Widget v6 (`pick` signature, `Point`/`Options` fields, validate endpoint): `docs/superpowers/research/2026-06-29-packeta-fulfillment-verification.md` §C (verbatim). **If a step conflicts with this doc, the doc wins.**
- Design spec: `docs/superpowers/specs/2026-06-29-m2-packeta-design.md` §5 (storefront wiring).
- The M2a backend provider (`fp_packeta_packeta`, option id `packeta-pickup`, the `pickup_point_*` data shape) must be merged first — the seed (M2a Task 12) creates the region + calculated option this checkout uses.

**Prerequisite:** M2a merged to `master`. **Branch:** `m2b-packeta-storefront` (off `master` after M2a merge). **Every commit uses `git commit -s` (DCO).**

## Global Constraints

- The storefront is **not** in the gated `pnpm build`; verify types directly with `pnpm --filter @medusa-cz/demo-storefront exec tsc --noEmit` after each storefront change (same as comgate M1 Tasks 10–11).
- **`apiKey` only** reaches the browser — never the secret `apiPassword`.
- The selected point's `data` keys MUST match what the M2a provider's `validateFulfillmentData` reads: `pickup_point_id`, `pickup_point_name`, `pickup_point_type`, `carrier_id`, `carrier_pickup_point_id`.
- Widget runs in an isolated iframe; do not trigger native dialogs. Use `console.log` + the browser console for debugging.

---

## File Structure

```
apps/storefront/src/
├── lib/
│   └── packeta.ts                                  # NEW — loadWidget() + pickPoint() typed wrappers
├── modules/checkout/components/
│   ├── packeta-pickup-point/index.tsx              # NEW — "Choose pickup point" button + selected display
│   └── delivery/ (existing shipping step)          # MODIFY — render the widget for the Packeta option
└── .env.template / .env.local                      # add NEXT_PUBLIC_PACKETA_API_KEY
```

> Exact path of the delivery/shipping step component is confirmed in Task 3 Step 1 (the Medusa Next.js starter names it `checkout/components/delivery` or `.../shipping`).

---

## Task 1: Typed Packeta Widget loader

**Files:**

- Create: `apps/storefront/src/lib/packeta.ts`
- Modify: `apps/storefront/.env.template`

**Interfaces:**

- Produces: `loadPacketaWidget(): Promise<void>`, `pickPacketaPoint(apiKey, options?): Promise<PacketaPoint | null>`, and the `PacketaPoint` type (subset of the research §C1 `Point`).

- [ ] **Step 1: Implement the loader + typed `pick` wrapper**

```ts
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
```

Add to `.env.template`: `NEXT_PUBLIC_PACKETA_API_KEY=`.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @medusa-cz/demo-storefront exec tsc --noEmit`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add apps/storefront/src/lib/packeta.ts apps/storefront/.env.template
git commit -s -m "feat(storefront): typed Packeta Widget v6 loader + pick wrapper"
```

---

## Task 2: Pickup-point picker component

**Files:**

- Create: `apps/storefront/src/modules/checkout/components/packeta-pickup-point/index.tsx`

**Interfaces:**

- Produces: `<PacketaPickupPoint value onChange />` where `value: PacketaPoint | null` and `onChange(point: PacketaPoint)`.

- [ ] **Step 1: Implement the component**

```tsx
"use client"

import { useState } from "react"
import { Button } from "@medusajs/ui"
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @medusa-cz/demo-storefront exec tsc --noEmit`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add apps/storefront/src/modules/checkout/components/packeta-pickup-point
git commit -s -m "feat(storefront): Packeta pickup-point picker component"
```

---

## Task 3: Wire the picker into the checkout delivery step

**Files:**

- Modify: the checkout shipping/delivery step component (path confirmed in Step 1)

- [ ] **Step 1: Locate and read the delivery step + `setShippingMethod`**

Run: `ls apps/storefront/src/modules/checkout/components/` and
`grep -rn "setShippingMethod\|addShippingMethod\|listCartShippingMethods\|calculatePriceForShippingOption" apps/storefront/src`
Confirm: the component that lists shipping options and calls `setShippingMethod(cartId, { option_id })`, and how it sets calculated-option price (the starter calls `calculatePriceForShippingOption` for `price_type: "calculated"`).

- [ ] **Step 2: Render the picker for the Packeta option and carry the point into `data`**

In the delivery step, when the chosen shipping option's `provider_id` is `fp_packeta_packeta` (or its `data.id === "packeta-pickup"`), render `<PacketaPickupPoint>` and, on selection, call the cart shipping-method setter with the point mapped into `data`:

```tsx
import PacketaPickupPoint from "@modules/checkout/components/packeta-pickup-point"
import { setShippingMethod } from "@lib/data/cart"
import type { PacketaPoint } from "@lib/packeta"
// ...

const [packetaPoint, setPacketaPoint] = useState<PacketaPoint | null>(null)

const isPacketa = (opt: HttpTypes.StoreCartShippingOption) =>
  opt.provider_id === "fp_packeta_packeta" || (opt.data as { id?: string })?.id === "packeta-pickup"

const onPacketaSelected = async (point: PacketaPoint) => {
  setPacketaPoint(point)
  await setShippingMethod({
    cartId: cart.id,
    shippingMethodId: selectedShippingOptionId!,
    data: {
      pickup_point_id: String(point.id),
      pickup_point_name: point.name,
      pickup_point_type: point.pickupPointType ?? "internal",
      carrier_id: point.carrierId,
      carrier_pickup_point_id: point.carrierPickupPointId,
    },
  })
}

// In the option row, when isPacketa(option) && option.id === selectedShippingOptionId:
//   <PacketaPickupPoint value={packetaPoint} onChange={onPacketaSelected} />
```

> **[Medium] — confirm during execution:** the starter's `setShippingMethod` signature. The current Medusa Next.js starter's `@lib/data/cart` exposes `setShippingMethod({ cartId, shippingMethodId, data })`. If this repo's version takes positional args or omits `data`, adapt to call `sdk.store.cart.addShippingMethod(cart.id, { option_id, data })` directly. The `data` keys above are the contract M2a's `validateFulfillmentData` reads — keep them exact.

- [ ] **Step 3: Gate "Continue" until a Packeta point is chosen**

When the selected option `isPacketa` and `!packetaPoint`, disable the delivery-step submit button (reuse the step's existing `disabled`/`notReady` prop): `disabled={notReady || (isPacketaSelected && !packetaPoint)}`.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @medusa-cz/demo-storefront exec tsc --noEmit`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/modules/checkout
git commit -s -m "feat(storefront): render Packeta picker in checkout; carry point into shipping data"
```

---

## Task 4: Manual acceptance round-trip + PR

**Files:**

- Modify: `packages/fulfillment-packeta/README.md` (add the storefront half to manual acceptance)

- [ ] **Step 1: Run the full stack**

```bash
# backend
export PACKETA_API_KEY=… PACKETA_API_PASSWORD=… PACKETA_ESHOP=<test-sender>
cd apps/backend && pnpm dev
# in another shell: seed region + option (M2a)
npx medusa exec ./src/scripts/seed-packeta.ts
# storefront — set NEXT_PUBLIC_PACKETA_API_KEY + a publishable key in .env.local
cd apps/storefront && pnpm dev
```

- [ ] **Step 2: Drive the round-trip in the browser (record a GIF if using browser automation)**

1. Add a product to the CZK-region cart → checkout.
2. Choose the "Packeta pickup point" shipping option → the picker appears.
3. Click "Choose pickup point" → the Widget opens → select a point → it shows under the option.
4. The calculated price renders; "Continue" enables → complete the order.
5. In admin: a fulfillment exists; **Create fulfillment** → packet created (check the order's fulfillment `data.packet_id`). Print the label (fulfillment documents). Refresh tracking. Close-batch.
6. Repeat with a COD order and an external-carrier point. Cancel the test packet(s) to clean up.

- [ ] **Step 3: Append the storefront acceptance steps to the README**

Add the browser steps above under the package README's "Manual acceptance" §, noting `NEXT_PUBLIC_PACKETA_API_KEY` and that the widget only uses the public `apiKey`.

- [ ] **Step 4: Storefront typecheck + commit + PR**

```bash
pnpm --filter @medusa-cz/demo-storefront exec tsc --noEmit
git add packages/fulfillment-packeta/README.md
git commit -s -m "docs(packeta): storefront manual acceptance (Widget v6 round-trip)"
git push -u origin m2b-packeta-storefront
gh pr create --base master --title "M2b: Packeta storefront Widget v6 + checkout" \
  --body "Implements the Packeta storefront pickup-point selection per docs/superpowers/plans/2026-06-29-m2b-packeta-storefront.md. Manual acceptance; depends on M2a."
```

---

## Self-Review

**Spec coverage** (against `2026-06-29-m2-packeta-design.md` §5 + M2-10):

- Widget v6 embed (`library.js` + `Packeta.Widget.pick`) → Task 1. ✓
- Pickup-point selection component → Task 2. ✓
- Carry point into shipping-method `data` (keys matching M2a `validateFulfillmentData`) → Task 3. ✓
- Calculated price rendering (starter's `calculatePriceForShippingOption`) → Task 3 Step 1 (confirm) + the option already `price_type: "calculated"` from M2a seed. ✓
- Manual round-trip acceptance (M2b half) → Task 4. ✓
- `apiKey`-only in browser → Global Constraints + Task 1/2. ✓

**Placeholder scan:** No "TBD". Two "[Medium] — confirm during execution" notes (delivery-step component path; `setShippingMethod` signature) — each gives the grep to run and the fallback (`sdk.store.cart.addShippingMethod`). Storefront typecheck (every task) catches drift. Same discipline as comgate Tasks 10–11.

**Type consistency:** `PacketaPoint` (Task 1) consumed by the component (Task 2) and the delivery wiring (Task 3). The `data` keys written in Task 3 (`pickup_point_id`, `pickup_point_name`, `pickup_point_type`, `carrier_id`, `carrier_pickup_point_id`) exactly match the M2a provider contract (`2026-06-29-m2a-packeta-backend.md` Tasks 8–9). Provider id `fp_packeta_packeta` matches the M2a seed + integration test.

**Out of scope (held):** map-based point search outside the widget, address (home) delivery, server-side catalog rendering — widget handles selection; backend handles the rest.
