# Packeta Fulfillment Provider — Backend (M2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the M0 `@medusa-cz/fulfillment-packeta` skeleton into a working Packeta (Zásilkovna) pickup-point fulfillment provider for MedusaJS 2.17 — pricing, packet create/cancel, returns, label PDFs, close-batch, and tracking — proven hermetically by mocked-HTTP unit tests (the blocking CI gate). The storefront Widget is M2b.

**Architecture:** A self-contained Packeta **REST/XML** client (`src/core/packeta-client.ts`) wraps the main API (`createPacket`, `cancelPacket`, `packetStatus`, `packetTracking`, `packetLabelPdf`, `createShipment`, `createPacketClaimWithPassword`, `senderGetReturnRouting`) over `fetch` + `fast-xml-parser`. `src/core/pricing.ts` is a pure country×weight price-table function. `src/core/widget-validate.ts` validates a chosen point server-side. `src/providers/packeta/service.ts` extends `AbstractFulfillmentProviderService` and maps Medusa's fulfillment contract onto these. Close-batch and tracking-refresh live as admin API routes. The demo registers the provider with a CZK region + a calculated pickup-point shipping option.

**Tech Stack:** TypeScript 5.x, MedusaJS 2.17.0 (`AbstractFulfillmentProviderService`), `fast-xml-parser`, Vitest (unit, mocked `fetch` — the CI gate), `@medusajs/test-utils` (Jest, integration), pnpm/Turbo workspace.

**Grounding (verified — do not re-derive from memory):**

- Packeta API + Medusa 2.17 fulfillment internals: `docs/superpowers/research/2026-06-29-packeta-fulfillment-verification.md` (the docs-gate, DONE). **If any step conflicts with this doc, the doc wins.**
- Design spec: `docs/superpowers/specs/2026-06-29-m2-packeta-design.md`.

**Branch:** `m2a-packeta-backend` (create off `master`, which is now on 2.17). **Every commit uses `git commit -s` (DCO).**

## Global Constraints

- **Medusa version: 2.17.0.** All `@medusajs/*` deps pinned to `2.17.0`, `@medusajs/ui` to `4.1.17` (already set in the skeleton package.json).
- **Packaging (PR #3 pattern):** the plugin builds to ESM under `.medusa/server`. **All relative value-imports MUST carry a `.js` extension** (`from "./service.js"`); package-name imports (`@medusajs/framework/utils`) do not. Keep the `providers/<name>/index.ts` entry, the `ModuleProvider(Modules.FULFILLMENT, …)` call, and the `./providers/*` export.
- **Two secrets, two roles:** `apiKey` (public — widget + pickup-point REST) vs `apiPassword` (secret — main API). `apiPassword` is server-only and never leaves the backend.
- **Packet id is 64-bit (`unsignedLong`) — treat as a `string` end-to-end** to avoid JS number truncation.
- **No Packeta sandbox.** Mocked-HTTP unit tests are the only CI gate. An opt-in live suite may run `createPacket`→`packetStatus`→`cancelPacket` with a test sender; **never `createShipment`** (no charge until physical hand-over).
- **`pnpm format:check` is the Windows CRLF false-positive trap** — trust CI (LF). Run `pnpm --filter @medusa-cz/fulfillment-packeta test` for the local gate.

---

## File Structure

```
packages/fulfillment-packeta/
├── package.json                       # add vitest + fast-xml-parser + test scripts
├── vitest.config.ts                   # NEW
├── src/
│   ├── types.ts                       # NEW — options, price table, Point/packet shapes, status maps, endpoints
│   ├── core/
│   │   ├── packeta-client.ts          # NEW — REST/XML client + PacketaError
│   │   ├── pricing.ts                 # NEW — pure country×weight price table
│   │   ├── widget-validate.ts         # NEW — server-side point validation
│   │   └── __tests__/
│   │       ├── packeta-client.test.ts # NEW
│   │       ├── pricing.test.ts        # NEW
│   │       └── widget-validate.test.ts# NEW
│   ├── providers/packeta/
│   │   ├── index.ts                   # FIX: import "./service.js"
│   │   └── service.ts                 # REPLACES the M0 skeleton body
│   ├── providers/packeta/__tests__/
│   │   └── service.test.ts            # NEW
│   ├── api/admin/packeta/
│   │   ├── close-batch/route.ts       # NEW — POST createShipment
│   │   └── tracking/[packetId]/route.ts # NEW — GET packetStatus/Tracking
│   ├── index.ts                       # FIX: import paths carry .js
│   └── __tests__/integration/
│       └── packeta-provider.test.ts   # NEW — @medusajs/test-utils, provider loads
└── README.md                          # install + options + manual acceptance

apps/backend/
├── medusa-config.ts                   # register the fulfillment provider
├── .env.template                      # add PACKETA_* keys
└── src/scripts/seed-packeta.ts        # NEW — CZK region + service zone + pickup-point shipping option
```

> **M0 layout note:** the skeleton co-locates the service at `src/providers/packeta/service.ts` (kept). The research confirms this layout loads fine — the hard invariants are the `.js` extensions, the `providers/packeta/index.ts` entry, the `ModuleProvider(Modules.FULFILLMENT, …)` call, and the `./providers/*` export.

---

## Task 1: Test harness + types + packaging `.js` fix

**Files:**

- Modify: `packages/fulfillment-packeta/package.json`
- Create: `packages/fulfillment-packeta/vitest.config.ts`
- Create: `packages/fulfillment-packeta/src/types.ts`
- Modify: `packages/fulfillment-packeta/src/providers/packeta/index.ts`
- Modify: `packages/fulfillment-packeta/src/index.ts`

- [ ] **Step 1: Add Vitest + fast-xml-parser + scripts to package.json**

Add to `dependencies`: `"fast-xml-parser": "^4.5.0"`. Add to `devDependencies`: `"vitest": "^2.1.0"`. Add scripts (merge with the existing `build`/`dev`/`lint`/`typecheck`):

```json
"scripts": {
  "build": "medusa plugin:build",
  "dev": "medusa plugin:develop",
  "prepublishOnly": "medusa plugin:build",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:integration": "vitest run --dir src/__tests__/integration",
  "lint": "eslint src",
  "typecheck": "tsc --noEmit"
}
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    // The opt-in live suite is excluded from the default (gate) run.
    exclude: ["**/node_modules/**", "src/__tests__/integration/**"],
  },
})
```

- [ ] **Step 3: Create `src/types.ts` with the verified shapes**

```ts
// REST/XML main API + widget validate endpoints (research §B, §C1).
export const PACKETA_REST_URL = "https://www.zasilkovna.cz/api/rest"
export const PACKETA_WIDGET_VALIDATE_URL =
  "https://widget.packeta.com/v6/pps/api/widget/v1/validate"

export interface PriceBand {
  /** inclusive upper bound, kg */
  maxWeight: number
  /** major units (e.g. CZK) */
  price: number
}
export interface CountryPricing {
  /** ascending by maxWeight; the last band catches anything heavier */
  bands: PriceBand[]
  /** added to the band price when the order is cash-on-delivery */
  codSurcharge?: number
  /** order subtotal ≥ this → shipping is free (price 0) */
  freeOver?: number
}
/** key = ISO-3166-1 alpha-2 lowercase, e.g. "cz" */
export type PriceTable = Record<string, CountryPricing>

export interface PacketaOptions {
  apiKey: string // public — widget + pickup-point REST
  apiPassword: string // secret — main API (server-only)
  eshop?: string // sender indication / test sender
  defaultCurrency?: string // default "CZK"
  priceTable: PriceTable
  validatePointServerSide?: boolean // default true
  labelFormat?: string // default "A6 on A4"
  optionId?: string // shipping option id this provider serves; default "packeta-pickup"
  optionName?: string // default "Packeta pickup point"
}

export type PickupPointType = "internal" | "external"

/** Packet attributes sent to createPacket (research §B1). */
export interface PacketAttributes extends Record<string, unknown> {
  number: string
  name: string
  surname: string
  email?: string
  phone?: string
  addressId: string // internal point id OR external carrierId
  carrierPickupPoint?: string // external carrier's point code
  currency?: string
  cod?: number
  value: number
  weight: number
  eshop?: string
}

export interface PacketIdDetail {
  id: string // 64-bit — keep as string
  barcode: string
}

/** Point fields persisted on the shipping-method `data` (subset of widget Point). */
export interface PacketaPointData extends Record<string, unknown> {
  pickup_point_id: string
  pickup_point_name?: string
  pickup_point_type?: PickupPointType
  carrier_id?: string
  carrier_pickup_point_id?: string
}

/** What we store on the fulfillment `data` after createPacket. */
export interface PacketaFulfillmentData extends PacketaPointData {
  packet_id?: string
  barcode?: string
}
```

- [ ] **Step 4: Fix the `.js` packaging pitfall (PR #3 pattern)**

`src/providers/packeta/index.ts`:

```ts
import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import PacketaProviderService from "./service.js"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [PacketaProviderService],
})
```

`src/index.ts`:

```ts
export { default as PacketaProviderService } from "./providers/packeta/service.js"
```

- [ ] **Step 5: Verify it still builds + typechecks**

Run: `pnpm --filter @medusa-cz/fulfillment-packeta typecheck && pnpm --filter @medusa-cz/fulfillment-packeta build`
Expected: both green (the service still returns `[]` from `getFulfillmentOptions`; fine for now).

- [ ] **Step 6: Commit**

```bash
git add packages/fulfillment-packeta
git commit -s -m "chore(packeta): vitest harness, types, fast-xml-parser, .js packaging fix"
```

---

## Task 2: Pricing — pure country×weight price table

**Files:**

- Create: `packages/fulfillment-packeta/src/core/pricing.ts`
- Create: `packages/fulfillment-packeta/src/core/__tests__/pricing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import { calculateShippingPrice } from "../pricing"
import type { PriceTable } from "../types"

const table: PriceTable = {
  cz: {
    bands: [
      { maxWeight: 5, price: 79 },
      { maxWeight: 10, price: 99 },
    ],
    codSurcharge: 30,
    freeOver: 1500,
  },
}

describe("calculateShippingPrice", () => {
  it("picks the band by weight (inclusive upper bound)", () => {
    expect(calculateShippingPrice(table, "cz", 3, {})).toBe(79)
    expect(calculateShippingPrice(table, "cz", 5, {})).toBe(79)
    expect(calculateShippingPrice(table, "cz", 7, {})).toBe(99)
  })

  it("falls back to the heaviest band when over the top bound", () => {
    expect(calculateShippingPrice(table, "cz", 50, {})).toBe(99)
  })

  it("adds the COD surcharge when cod=true", () => {
    expect(calculateShippingPrice(table, "cz", 3, { cod: true })).toBe(109)
  })

  it("is free when subtotal ≥ freeOver (even with COD)", () => {
    expect(calculateShippingPrice(table, "cz", 3, { cod: true, subtotal: 1500 })).toBe(0)
  })

  it("is case-insensitive on country", () => {
    expect(calculateShippingPrice(table, "CZ", 3, {})).toBe(79)
  })

  it("throws for an unconfigured country", () => {
    expect(() => calculateShippingPrice(table, "de", 3, {})).toThrow(/no packeta price/i)
  })
})
```

- [ ] **Step 2: Run it; verify it fails**

Run: `pnpm --filter @medusa-cz/fulfillment-packeta test`
Expected: FAIL — `pricing` module not found.

- [ ] **Step 3: Implement the pure pricing function**

```ts
import type { PriceTable } from "./types.js"

export interface PriceContext {
  /** order is cash-on-delivery */
  cod?: boolean
  /** order subtotal in major units (for free-over-threshold) */
  subtotal?: number
}

export function calculateShippingPrice(
  table: PriceTable,
  country: string,
  weightKg: number,
  ctx: PriceContext
): number {
  const cp = table[country.toLowerCase()]
  if (!cp) {
    throw new Error(`No Packeta price configured for country "${country}"`)
  }
  if (ctx.subtotal != null && cp.freeOver != null && ctx.subtotal >= cp.freeOver) {
    return 0
  }
  const sorted = [...cp.bands].sort((a, b) => a.maxWeight - b.maxWeight)
  const band = sorted.find((b) => weightKg <= b.maxWeight) ?? sorted[sorted.length - 1]
  let price = band.price
  if (ctx.cod && cp.codSurcharge) {
    price += cp.codSurcharge
  }
  return price
}
```

- [ ] **Step 4: Run tests; verify pass**

Run: `pnpm --filter @medusa-cz/fulfillment-packeta test`
Expected: PASS (6 cases).

- [ ] **Step 5: Commit**

```bash
git add packages/fulfillment-packeta/src/core/pricing.ts packages/fulfillment-packeta/src/core/__tests__/pricing.test.ts
git commit -s -m "feat(packeta): pure country×weight pricing with COD + free-over (TDD)"
```

---

## Task 3: REST/XML client — transport + `createPacket`

**Files:**

- Create: `packages/fulfillment-packeta/src/core/packeta-client.ts`
- Create: `packages/fulfillment-packeta/src/core/__tests__/packeta-client.test.ts`

**Interfaces:**

- Produces: `class PacketaClient` (ctor `{ apiPassword: string; url?: string; fetchFn?: typeof fetch }`), `class PacketaError`. Methods added across Tasks 3–5: `createPacket`, `cancelPacket`, `packetStatus`, `packetTracking`, `packetLabelPdf`, `createShipment`, `createPacketClaim`, `senderGetReturnRouting`.

> **Packeta REST/XML envelope [Medium] — confirm against a real response during the opt-in live run (Task 11).** Request: an XML doc whose root element is the method name, first child `<apiPassword>` (research §B). Response: `<response status="ok|fault">` with payload under `<result>` on success and `<fault>`/`<string>` on error (the shape the official PrestaShop/WooCommerce plugins parse). The client centralizes parsing in `call()` so only one place changes if the envelope differs.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { PacketaClient, PacketaError } from "../packeta-client"

const opts = { apiPassword: "deadbeef".repeat(4) } // 32 hex chars

function mockFetchOnce(status: number, xml: string) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => xml,
  }) as unknown as typeof fetch
}

beforeEach(() => vi.restoreAllMocks())

describe("PacketaClient.createPacket", () => {
  it("POSTs XML rooted at the method name with apiPassword first, returns id+barcode as strings", async () => {
    mockFetchOnce(
      200,
      `<response status="ok"><result><id>9007199254740993</id><barcode>Z9007199254740993</barcode></result></response>`
    )
    const client = new PacketaClient(opts)
    const res = await client.createPacket({
      number: "42",
      name: "Jan",
      surname: "Novák",
      email: "jan@example.com",
      addressId: "79",
      value: 145.5,
      weight: 2,
    })
    // 64-bit id preserved as string (would lose precision as a JS number)
    expect(res.id).toBe("9007199254740993")
    expect(res.barcode).toBe("Z9007199254740993")

    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe("https://www.zasilkovna.cz/api/rest")
    expect(call[1].method).toBe("POST")
    const body = call[1].body as string
    expect(body).toContain("<createPacket>")
    // apiPassword present and appears before the recipient name
    expect(body.indexOf("<apiPassword>")).toBeGreaterThan(-1)
    expect(body.indexOf("<apiPassword>")).toBeLessThan(body.indexOf("<name>"))
  })

  it("throws PacketaError on a fault response", async () => {
    mockFetchOnce(
      200,
      `<response status="fault"><fault>IncorrectApiPasswordFault</fault><string>Wrong password</string></response>`
    )
    const client = new PacketaClient(opts)
    await expect(
      client.createPacket({
        number: "1",
        name: "A",
        surname: "B",
        addressId: "79",
        value: 1,
        weight: 1,
      })
    ).rejects.toBeInstanceOf(PacketaError)
  })

  it("tags 5xx as retryable", async () => {
    mockFetchOnce(503, "")
    await expect(
      new PacketaClient(opts).createPacket({
        number: "1",
        name: "A",
        surname: "B",
        addressId: "79",
        value: 1,
        weight: 1,
      })
    ).rejects.toMatchObject({ retryable: true })
  })
})
```

- [ ] **Step 2: Run; verify fail**

Run: `pnpm --filter @medusa-cz/fulfillment-packeta test`
Expected: FAIL — `packeta-client` not found.

- [ ] **Step 3: Implement transport + `createPacket`**

```ts
import { XMLBuilder, XMLParser } from "fast-xml-parser"
import { PACKETA_REST_URL } from "./types.js"
import type { PacketAttributes, PacketIdDetail } from "./types.js"

export class PacketaError extends Error {
  readonly name = "PacketaError"
  constructor(
    readonly fault: string,
    message: string,
    readonly retryable = false
  ) {
    super(message)
  }
}

export interface PacketaClientOptions {
  apiPassword: string
  url?: string
  fetchFn?: typeof fetch
}

export class PacketaClient {
  private readonly url: string
  private readonly apiPassword: string
  private readonly fetchFn: typeof fetch
  private readonly builder: XMLBuilder
  private readonly parser: XMLParser

  constructor(opts: PacketaClientOptions) {
    this.url = opts.url ?? PACKETA_REST_URL
    this.apiPassword = opts.apiPassword
    this.fetchFn = opts.fetchFn ?? fetch
    // Keep numeric-looking values as strings so 64-bit ids never become JS numbers.
    this.builder = new XMLBuilder({ suppressEmptyNode: true })
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseTagValue: false,
    })
  }

  /** POST one XML method call; return the parsed `<result>` (or root) on success. */
  protected async call<T = Record<string, unknown>>(
    method: string,
    args: Record<string, unknown>
  ): Promise<T> {
    // apiPassword MUST be the first element (research §B).
    const xml = this.builder.build({ [method]: { apiPassword: this.apiPassword, ...args } })
    let res: Response
    try {
      res = await this.fetchFn(this.url, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8" },
        body: xml,
      })
    } catch (e) {
      throw new PacketaError("NetworkError", `Packeta network error: ${(e as Error).message}`, true)
    }
    if (!res.ok) {
      throw new PacketaError("HttpError", `Packeta HTTP ${res.status}`, res.status >= 500)
    }
    const parsed = this.parser.parse(await res.text()) as Record<string, any>
    const root = parsed.response ?? Object.values(parsed)[0] ?? {}
    const status = root["@_status"] ?? root.status
    if (status === "fault" || root.fault) {
      throw new PacketaError(
        String(root.fault ?? "fault"),
        String(root.string ?? root.detail ?? "Packeta API fault")
      )
    }
    return (root.result ?? root) as T
  }

  async createPacket(attrs: PacketAttributes): Promise<PacketIdDetail> {
    const result = await this.call<{ id: string | number; barcode: string }>("createPacket", {
      packetAttributes: attrs,
    })
    return { id: String(result.id), barcode: String(result.barcode) }
  }
}
```

- [ ] **Step 4: Run; verify pass**

Run: `pnpm --filter @medusa-cz/fulfillment-packeta test`
Expected: PASS (3 cases). If the `id` assertion fails because the parser coerced the number, confirm `parseTagValue: false` is set (it keeps `<id>` a string).

- [ ] **Step 5: Commit**

```bash
git add packages/fulfillment-packeta/src/core/packeta-client.ts packages/fulfillment-packeta/src/core/__tests__/packeta-client.test.ts
git commit -s -m "feat(packeta): REST/XML client transport + createPacket (TDD)"
```

---

## Task 4: Client — `cancelPacket`, `packetStatus`, `packetTracking`

**Files:**

- Modify: `packages/fulfillment-packeta/src/core/packeta-client.ts`
- Modify: `packages/fulfillment-packeta/src/core/__tests__/packeta-client.test.ts`

**Interfaces:**

- Produces: `cancelPacket(packetId: string): Promise<void>`, `packetStatus(packetId: string): Promise<{ statusCode: string; statusText: string }>`, `packetTracking(packetId: string): Promise<Array<{ statusCode: string; statusText: string; dateTime?: string }>>`.

- [ ] **Step 1: Add failing tests**

```ts
describe("PacketaClient cancel/status/tracking", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("cancelPacket sends the packetId and resolves on ok", async () => {
    mockFetchOnce(200, `<response status="ok"><result/></response>`)
    await new PacketaClient(opts).cancelPacket("9007199254740993")
    const body = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .body as string
    expect(body).toContain("<cancelPacket>")
    expect(body).toContain("<packetId>9007199254740993</packetId>")
  })

  it("packetStatus returns code + text", async () => {
    mockFetchOnce(
      200,
      `<response status="ok"><result><statusCode>2</statusCode><statusText>Accepted</statusText></result></response>`
    )
    const res = await new PacketaClient(opts).packetStatus("1")
    expect(res).toEqual({ statusCode: "2", statusText: "Accepted" })
  })

  it("packetTracking returns an array even for a single record", async () => {
    mockFetchOnce(
      200,
      `<response status="ok"><result><record><statusCode>1</statusCode><statusText>Created</statusText></record></result></response>`
    )
    const res = await new PacketaClient(opts).packetTracking("1")
    expect(Array.isArray(res)).toBe(true)
    expect(res[0]).toMatchObject({ statusCode: "1", statusText: "Created" })
  })
})
```

- [ ] **Step 2: Run; verify fail.** Run: `pnpm --filter @medusa-cz/fulfillment-packeta test` → FAIL.

- [ ] **Step 3: Implement the three methods (append to `PacketaClient`)**

```ts
  async cancelPacket(packetId: string): Promise<void> {
    await this.call("cancelPacket", { packetId })
  }

  async packetStatus(packetId: string): Promise<{ statusCode: string; statusText: string }> {
    const r = await this.call<{ statusCode: string | number; statusText: string }>("packetStatus", {
      packetId,
    })
    return { statusCode: String(r.statusCode), statusText: String(r.statusText ?? "") }
  }

  async packetTracking(
    packetId: string
  ): Promise<Array<{ statusCode: string; statusText: string; dateTime?: string }>> {
    const r = await this.call<{ record?: unknown }>("packetTracking", { packetId })
    const records = r.record == null ? [] : Array.isArray(r.record) ? r.record : [r.record]
    return records.map((rec) => {
      const x = rec as Record<string, unknown>
      return {
        statusCode: String(x.statusCode ?? ""),
        statusText: String(x.statusText ?? ""),
        dateTime: x.dateTime != null ? String(x.dateTime) : undefined,
      }
    })
  }
```

- [ ] **Step 4: Run; verify pass.** → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/fulfillment-packeta/src/core
git commit -s -m "feat(packeta): client cancelPacket + packetStatus + packetTracking (TDD)"
```

---

## Task 5: Client — `packetLabelPdf`, `createShipment`, returns (`createPacketClaim`, `senderGetReturnRouting`)

**Files:**

- Modify: `packages/fulfillment-packeta/src/core/packeta-client.ts`
- Modify: `packages/fulfillment-packeta/src/core/__tests__/packeta-client.test.ts`

**Interfaces:**

- Produces: `packetLabelPdf(packetId: string, format: string, offset?: number): Promise<string>` (base64 PDF), `createShipment(packetIds: string[], customBarcode?: string): Promise<{ id: string; barcode: string }>`, `createPacketClaim(attrs: Record<string, unknown>): Promise<PacketIdDetail>`, `senderGetReturnRouting(senderLabel: string): Promise<string[]>`.

- [ ] **Step 1: Add failing tests**

```ts
describe("PacketaClient label/shipment/returns", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("packetLabelPdf returns the base64 string from <result>", async () => {
    mockFetchOnce(200, `<response status="ok"><result>JVBERi0xLjQK</result></response>`)
    const b64 = await new PacketaClient(opts).packetLabelPdf("1", "A6 on A4")
    expect(b64).toBe("JVBERi0xLjQK")
    const body = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .body as string
    expect(body).toContain("<packetLabelPdf>")
    expect(body).toContain("<format>A6 on A4</format>")
  })

  it("createShipment sends all packetIds and returns the shipment id", async () => {
    mockFetchOnce(
      200,
      `<response status="ok"><result><id>S123</id><barcode>BS123</barcode></result></response>`
    )
    const res = await new PacketaClient(opts).createShipment(["1", "2"])
    expect(res).toEqual({ id: "S123", barcode: "BS123" })
    const body = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .body as string
    expect(body).toContain("<createShipment>")
    expect(body).toContain("<id>1</id>")
    expect(body).toContain("<id>2</id>")
  })

  it("createPacketClaim returns id+barcode as strings", async () => {
    mockFetchOnce(
      200,
      `<response status="ok"><result><id>77</id><barcode>Z77</barcode></result></response>`
    )
    const res = await new PacketaClient(opts).createPacketClaim({ number: "ret-1", value: 10 })
    expect(res).toEqual({ id: "77", barcode: "Z77" })
  })

  it("senderGetReturnRouting returns an array of strings", async () => {
    mockFetchOnce(
      200,
      `<response status="ok"><result><string>r1</string><string>r2</string></result></response>`
    )
    const res = await new PacketaClient(opts).senderGetReturnRouting("my-sender")
    expect(res).toEqual(["r1", "r2"])
  })
})
```

- [ ] **Step 2: Run; verify fail.** → FAIL.

- [ ] **Step 3: Implement (append to `PacketaClient`)**

```ts
  async packetLabelPdf(packetId: string, format: string, offset = 0): Promise<string> {
    const r = await this.call<{ "#text"?: string } | string>("packetLabelPdf", {
      packetId,
      format,
      offset,
    })
    // <result> holds the base64 PDF directly (text node).
    return typeof r === "string" ? r : String((r as Record<string, unknown>)["#text"] ?? r)
  }

  async createShipment(
    packetIds: string[],
    customBarcode?: string
  ): Promise<{ id: string; barcode: string }> {
    const r = await this.call<{ id: string | number; barcode: string }>("createShipment", {
      packetIds: { id: packetIds },
      ...(customBarcode ? { customBarcode } : {}),
    })
    return { id: String(r.id), barcode: String(r.barcode) }
  }

  async createPacketClaim(attrs: Record<string, unknown>): Promise<PacketIdDetail> {
    const r = await this.call<{ id: string | number; barcode: string }>(
      "createPacketClaimWithPassword",
      { attributes: attrs }
    )
    return { id: String(r.id), barcode: String(r.barcode) }
  }

  async senderGetReturnRouting(senderLabel: string): Promise<string[]> {
    const r = await this.call<{ string?: unknown }>("senderGetReturnRouting", { senderLabel })
    const v = r.string
    return v == null ? [] : (Array.isArray(v) ? v : [v]).map(String)
  }
```

- [ ] **Step 4: Run; verify pass.** → PASS. Run the whole client suite: `pnpm --filter @medusa-cz/fulfillment-packeta test` → all client + pricing tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/fulfillment-packeta/src/core
git commit -s -m "feat(packeta): client labelPdf + createShipment + returns (TDD)"
```

---

## Task 6: Server-side point validation client

**Files:**

- Create: `packages/fulfillment-packeta/src/core/widget-validate.ts`
- Create: `packages/fulfillment-packeta/src/core/__tests__/widget-validate.test.ts`

**Interfaces:**

- Produces: `validatePoint(args: { apiKey: string; point: { id?: string; carrierId?: string; carrierPickupPointId?: string }; options?: Record<string, unknown>; fetchFn?: typeof fetch }): Promise<{ isValid: boolean; errors: string[] }>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { validatePoint } from "../widget-validate"

function mockJsonOnce(status: number, body: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch
}

beforeEach(() => vi.restoreAllMocks())

describe("validatePoint", () => {
  it("POSTs apiKey + point to the validate endpoint and returns isValid", async () => {
    mockJsonOnce(200, { isValid: true, errors: [] })
    const res = await validatePoint({ apiKey: "KEY", point: { id: "79" } })
    expect(res).toEqual({ isValid: true, errors: [] })
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe("https://widget.packeta.com/v6/pps/api/widget/v1/validate")
    expect(JSON.parse(call[1].body)).toMatchObject({ apiKey: "KEY", point: { id: "79" } })
  })

  it("returns isValid=false with mapped errors", async () => {
    mockJsonOnce(200, {
      isValid: false,
      errors: [{ code: "NotFound" }, { code: "NoCashOnDelivery" }],
    })
    const res = await validatePoint({ apiKey: "KEY", point: { id: "1" } })
    expect(res.isValid).toBe(false)
    expect(res.errors).toEqual(["NotFound", "NoCashOnDelivery"])
  })

  it("treats a 401 as invalid with an api-key error", async () => {
    mockJsonOnce(401, {})
    const res = await validatePoint({ apiKey: "BAD", point: { id: "1" } })
    expect(res.isValid).toBe(false)
    expect(res.errors).toContain("InvalidApiKey")
  })
})
```

- [ ] **Step 2: Run; verify fail.** → FAIL.

- [ ] **Step 3: Implement**

```ts
import { PACKETA_WIDGET_VALIDATE_URL } from "./types.js"

export interface ValidatePointArgs {
  apiKey: string
  point: { id?: string; carrierId?: string; carrierPickupPointId?: string }
  options?: Record<string, unknown>
  fetchFn?: typeof fetch
}

export async function validatePoint(
  args: ValidatePointArgs
): Promise<{ isValid: boolean; errors: string[] }> {
  const fetchFn = args.fetchFn ?? fetch
  let res: Response
  try {
    res = await fetchFn(PACKETA_WIDGET_VALIDATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: args.apiKey, point: args.point, options: args.options ?? {} }),
    })
  } catch {
    // Network failure → don't hard-block checkout; treat as invalid with a clear code.
    return { isValid: false, errors: ["ValidationUnavailable"] }
  }
  if (res.status === 401) {
    return { isValid: false, errors: ["InvalidApiKey"] }
  }
  if (!res.ok) {
    return { isValid: false, errors: [`HTTP_${res.status}`] }
  }
  const body = (await res.json()) as {
    isValid?: boolean
    errors?: Array<{ code?: string } | string>
  }
  const errors = (body.errors ?? []).map((e) => (typeof e === "string" ? e : (e.code ?? "Unknown")))
  return { isValid: !!body.isValid, errors }
}
```

- [ ] **Step 4: Run; verify pass.** → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/fulfillment-packeta/src/core/widget-validate.ts packages/fulfillment-packeta/src/core/__tests__/widget-validate.test.ts
git commit -s -m "feat(packeta): server-side widget point validation (TDD)"
```

---

## Task 7: Provider — `validateOptions` + `getFulfillmentOptions` + `canCalculate` + `calculatePrice`

**Files:**

- Modify: `packages/fulfillment-packeta/src/providers/packeta/service.ts`
- Create: `packages/fulfillment-packeta/src/providers/packeta/__tests__/service.test.ts`

**Interfaces:**

- Consumes: `PacketaClient` (Tasks 3–5), `calculateShippingPrice` (Task 2), `validatePoint` (Task 6).
- Produces: `class PacketaProviderService extends AbstractFulfillmentProviderService` with `static identifier = "packeta"`.

> **`calculatePrice` context [Medium] — confirm field paths during Task 12 integration.** The destination country comes from the cart shipping address and the total weight from the items, both inside `context`. The plan reads `context.shipping_address?.country_code` and sums `context.items[].variant?.weight × quantity` (fallbacks included). Adjust the exact paths if the integration test shows a different shape; the pure `calculateShippingPrice` (Task 2) is unaffected.

- [ ] **Step 1: Write the failing test (mock the client + validator)**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const createPacket = vi.fn()
const cancelPacket = vi.fn()
const packetLabelPdf = vi.fn()
const createPacketClaim = vi.fn()
vi.mock("../../../core/packeta-client", () => ({
  PacketaError: class extends Error {},
  PacketaClient: vi.fn().mockImplementation(() => ({
    createPacket,
    cancelPacket,
    packetLabelPdf,
    createPacketClaim,
  })),
}))
const validatePoint = vi.fn()
vi.mock("../../../core/widget-validate", () => ({ validatePoint }))

import PacketaProviderService from "../service"
import type { PacketaOptions } from "../../../types"

const options: PacketaOptions = {
  apiKey: "KEY",
  apiPassword: "PW",
  defaultCurrency: "CZK",
  priceTable: { cz: { bands: [{ maxWeight: 5, price: 79 }], codSurcharge: 30, freeOver: 1500 } },
}

function makeProvider(opts: PacketaOptions = options) {
  return new PacketaProviderService({} as Record<string, unknown>, opts)
}

beforeEach(() => vi.clearAllMocks())

describe("validateOptions", () => {
  it("throws when apiKey or apiPassword is missing", () => {
    expect(() => PacketaProviderService.validateOptions({ apiKey: "x" })).toThrow(/apiPassword/i)
    expect(() => PacketaProviderService.validateOptions({ apiPassword: "x" })).toThrow(/apiKey/i)
  })
})

describe("getFulfillmentOptions", () => {
  it("returns one option from config (id + name)", async () => {
    const opts = await makeProvider().getFulfillmentOptions()
    expect(opts).toEqual([{ id: "packeta-pickup", name: "Packeta pickup point" }])
  })
})

describe("canCalculate / calculatePrice", () => {
  it("canCalculate is always true", async () => {
    expect(await makeProvider().canCalculate({} as never)).toBe(true)
  })

  it("calculatePrice prices by country×weight from context", async () => {
    const res = await makeProvider().calculatePrice(
      {} as never,
      { cod: false } as never,
      {
        shipping_address: { country_code: "cz" },
        items: [{ variant: { weight: 2 }, quantity: 2 }],
      } as never
    )
    // 2 items × 2kg = 4kg → 79
    expect(res).toMatchObject({ calculated_amount: 79, is_calculated_price_tax_inclusive: false })
  })

  it("calculatePrice adds COD surcharge when data.cod is set", async () => {
    const res = await makeProvider().calculatePrice(
      {} as never,
      { cod: true } as never,
      {
        shipping_address: { country_code: "cz" },
        items: [{ variant: { weight: 1 }, quantity: 1 }],
      } as never
    )
    expect(res).toMatchObject({ calculated_amount: 109 })
  })
})
```

- [ ] **Step 2: Run; verify fail.** → FAIL (skeleton returns `[]` and has no other methods).

- [ ] **Step 3: Implement the provider core (replace the skeleton body)**

```ts
import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils"
import { PacketaClient } from "../../core/packeta-client.js"
import { calculateShippingPrice } from "../../core/pricing.js"
import { validatePoint } from "../../core/widget-validate.js"
import type { PacketaOptions, PacketaPointData } from "../../types.js"

class PacketaProviderService extends AbstractFulfillmentProviderService {
  static identifier = "packeta"

  protected options_: PacketaOptions
  protected client_: PacketaClient

  static validateOptions(options: Record<string, unknown>): void {
    if (!options.apiKey) {
      throw new Error("Packeta provider requires an `apiKey` option")
    }
    if (!options.apiPassword) {
      throw new Error("Packeta provider requires an `apiPassword` option")
    }
  }

  constructor(_container: Record<string, unknown>, options: PacketaOptions) {
    super()
    this.options_ = options
    this.client_ = new PacketaClient({ apiPassword: options.apiPassword })
  }

  private get optionId_(): string {
    return this.options_.optionId ?? "packeta-pickup"
  }

  async getFulfillmentOptions(): Promise<Array<{ id: string; name: string }>> {
    return [{ id: this.optionId_, name: this.options_.optionName ?? "Packeta pickup point" }]
  }

  async canCalculate(): Promise<boolean> {
    return true
  }

  async calculatePrice(
    _optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<{ calculated_amount: number; is_calculated_price_tax_inclusive: boolean }> {
    const country =
      ((context.shipping_address as Record<string, unknown> | undefined)?.country_code as string) ??
      (this.options_.defaultCurrency === "CZK" ? "cz" : "cz")
    const items = (context.items as Array<Record<string, any>> | undefined) ?? []
    const weight = items.reduce(
      (sum, it) =>
        sum + (Number(it?.variant?.weight ?? it?.weight ?? 0) || 0) * (it?.quantity ?? 1),
      0
    )
    const subtotal = Number((context.item_total as number) ?? (context.subtotal as number) ?? 0)
    const amount = calculateShippingPrice(this.options_.priceTable, country, weight, {
      cod: !!data.cod,
      subtotal: subtotal || undefined,
    })
    return { calculated_amount: amount, is_calculated_price_tax_inclusive: false }
  }
}

export default PacketaProviderService
```

- [ ] **Step 4: Run; verify pass.** → PASS (validateOptions, getFulfillmentOptions, canCalculate, 2× calculatePrice).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @medusa-cz/fulfillment-packeta typecheck
git add packages/fulfillment-packeta/src/providers/packeta
git commit -s -m "feat(packeta): provider options/options-list/canCalculate/calculatePrice (TDD)"
```

---

## Task 8: Provider — `validateFulfillmentData` (+ optional server-side validation)

**Files:**

- Modify: `packages/fulfillment-packeta/src/providers/packeta/service.ts`
- Modify: `packages/fulfillment-packeta/src/providers/packeta/__tests__/service.test.ts`

**Interfaces:**

- Produces: `validateFulfillmentData(optionData, data, context): Promise<Record<string, unknown>>` returning the normalized `PacketaPointData`.

- [ ] **Step 1: Add failing tests**

```ts
describe("validateFulfillmentData", () => {
  it("normalizes an internal point and persists it (server validation off)", async () => {
    const provider = makeProvider({ ...options, validatePointServerSide: false })
    const out = await provider.validateFulfillmentData(
      {},
      { pickup_point_id: "79", pickup_point_name: "Praha 1", pickup_point_type: "internal" },
      {}
    )
    expect(out).toMatchObject({ pickup_point_id: "79", pickup_point_type: "internal" })
    expect(validatePoint).not.toHaveBeenCalled()
  })

  it("maps an external point's carrier ids", async () => {
    const provider = makeProvider({ ...options, validatePointServerSide: false })
    const out = await provider.validateFulfillmentData(
      {},
      {
        pickup_point_id: "3060",
        pickup_point_type: "external",
        carrier_id: "3060",
        carrier_pickup_point_id: "ABC",
      },
      {}
    )
    expect(out).toMatchObject({
      pickup_point_type: "external",
      carrier_id: "3060",
      carrier_pickup_point_id: "ABC",
    })
  })

  it("throws when no pickup point is present", async () => {
    await expect(
      makeProvider({ ...options, validatePointServerSide: false }).validateFulfillmentData(
        {},
        {},
        {}
      )
    ).rejects.toThrow(/pickup point/i)
  })

  it("calls the validate endpoint when enabled and rejects an invalid point", async () => {
    validatePoint.mockResolvedValue({ isValid: false, errors: ["NotFound"] })
    await expect(
      makeProvider({ ...options, validatePointServerSide: true }).validateFulfillmentData(
        {},
        { pickup_point_id: "1" },
        {}
      )
    ).rejects.toThrow(/NotFound/)
    expect(validatePoint).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "KEY", point: { id: "1" } })
    )
  })
})
```

- [ ] **Step 2: Run; verify fail.** → FAIL.

- [ ] **Step 3: Implement (append to the provider)**

```ts
  async validateFulfillmentData(
    _optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    _context: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const id = data.pickup_point_id as string | undefined
    if (!id) {
      throw new Error("Packeta: no pickup point selected (missing `pickup_point_id`)")
    }
    const type = (data.pickup_point_type as string) === "external" ? "external" : "internal"
    const normalized: PacketaPointData = {
      pickup_point_id: String(id),
      pickup_point_name: data.pickup_point_name as string | undefined,
      pickup_point_type: type,
      carrier_id: data.carrier_id as string | undefined,
      carrier_pickup_point_id: data.carrier_pickup_point_id as string | undefined,
    }

    if (this.options_.validatePointServerSide !== false) {
      const point =
        type === "external"
          ? {
              carrierId: normalized.carrier_id,
              carrierPickupPointId: normalized.carrier_pickup_point_id,
            }
          : { id: normalized.pickup_point_id }
      const { isValid, errors } = await validatePoint({ apiKey: this.options_.apiKey, point })
      if (!isValid) {
        throw new Error(`Packeta: invalid pickup point — ${errors.join(", ") || "validation failed"}`)
      }
    }
    return normalized
  }
```

- [ ] **Step 4: Run; verify pass.** → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/fulfillment-packeta/src/providers/packeta
git commit -s -m "feat(packeta): validateFulfillmentData with optional server-side validation (TDD)"
```

---

## Task 9: Provider — `createFulfillment` (+ COD, external) + `cancelFulfillment`

**Files:**

- Modify: `packages/fulfillment-packeta/src/providers/packeta/service.ts`
- Modify: `packages/fulfillment-packeta/src/providers/packeta/__tests__/service.test.ts`

**Interfaces:**

- Produces: `createFulfillment(data, items, order, fulfillment): Promise<{ data: Record<string, unknown>; labels: never[] }>`, `cancelFulfillment(data): Promise<void>`.

> **`order`/`items` shape [Medium] — confirm during Task 12.** The plan reads recipient name/email/phone from `order.shipping_address` / `order.email` and `number` from `order.display_id ?? order.id`, total `value` from `order.item_total`, and `weight` summed from `items[].variant?.weight × quantity`. Adjust paths if the integration test shows a different DTO; the `createPacket` client call is unaffected.

- [ ] **Step 1: Add failing tests**

```ts
describe("createFulfillment", () => {
  const order = {
    id: "order_1",
    display_id: 42,
    email: "jan@example.com",
    item_total: 500,
    shipping_address: { first_name: "Jan", last_name: "Novák", phone: "+420777123456" },
  }
  const items = [{ variant: { weight: 2 }, quantity: 1 }]

  it("internal point → createPacket with addressId = pickup_point_id; stores packet id+barcode", async () => {
    createPacket.mockResolvedValue({ id: "900719925474099", barcode: "Z900719925474099" })
    const data = { pickup_point_id: "79", pickup_point_type: "internal" }
    const res = await makeProvider().createFulfillment(
      data,
      items as never,
      order as never,
      {} as never
    )
    expect(createPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        number: "42",
        name: "Jan",
        surname: "Novák",
        email: "jan@example.com",
        addressId: "79",
        value: 500,
        weight: 2,
      })
    )
    expect(res.data).toMatchObject({ packet_id: "900719925474099", barcode: "Z900719925474099" })
    expect(res.labels).toEqual([])
  })

  it("external point → addressId = carrier_id and carrierPickupPoint set", async () => {
    createPacket.mockResolvedValue({ id: "1", barcode: "Z1" })
    const data = {
      pickup_point_id: "3060",
      pickup_point_type: "external",
      carrier_id: "3060",
      carrier_pickup_point_id: "ABC",
    }
    await makeProvider().createFulfillment(data, items as never, order as never, {} as never)
    expect(createPacket).toHaveBeenCalledWith(
      expect.objectContaining({ addressId: "3060", carrierPickupPoint: "ABC" })
    )
  })

  it("COD order → cod + currency set on the packet", async () => {
    createPacket.mockResolvedValue({ id: "1", barcode: "Z1" })
    const data = { pickup_point_id: "79", cod: true, cod_amount: 500 }
    await makeProvider().createFulfillment(data, items as never, order as never, {} as never)
    expect(createPacket).toHaveBeenCalledWith(
      expect.objectContaining({ cod: 500, currency: "CZK" })
    )
  })
})

describe("cancelFulfillment", () => {
  it("cancels the stored packet id", async () => {
    cancelPacket.mockResolvedValue(undefined)
    await makeProvider().cancelFulfillment({ packet_id: "900719925474099" })
    expect(cancelPacket).toHaveBeenCalledWith("900719925474099")
  })
})
```

- [ ] **Step 2: Run; verify fail.** → FAIL.

- [ ] **Step 3: Implement (append to the provider)**

```ts
  async createFulfillment(
    data: Record<string, unknown>,
    items: Array<Record<string, any>>,
    order: Record<string, any> | undefined,
    _fulfillment: Record<string, unknown>
  ): Promise<{ data: Record<string, unknown>; labels: never[] }> {
    const addr = (order?.shipping_address ?? {}) as Record<string, any>
    const isExternal = (data.pickup_point_type as string) === "external"
    const weight =
      items.reduce(
        (sum, it) => sum + (Number(it?.variant?.weight ?? it?.weight ?? 0) || 0) * (it?.quantity ?? 1),
        0
      ) || 0
    const cod = data.cod ? Number(data.cod_amount ?? order?.item_total ?? 0) : undefined

    const result = await this.client_.createPacket({
      number: String(order?.display_id ?? order?.id ?? ""),
      name: String(addr.first_name ?? ""),
      surname: String(addr.last_name ?? ""),
      email: order?.email ? String(order.email) : undefined,
      phone: addr.phone ? String(addr.phone) : undefined,
      addressId: isExternal
        ? String(data.carrier_id ?? data.pickup_point_id)
        : String(data.pickup_point_id),
      carrierPickupPoint: isExternal
        ? String(data.carrier_pickup_point_id ?? "")
        : undefined,
      value: Number(order?.item_total ?? 0),
      weight,
      ...(cod != null ? { cod, currency: this.options_.defaultCurrency ?? "CZK" } : {}),
      eshop: this.options_.eshop,
    })

    return {
      data: { ...data, packet_id: result.id, barcode: result.barcode },
      labels: [],
    }
  }

  async cancelFulfillment(data: Record<string, unknown>): Promise<void> {
    const packetId = data.packet_id as string | undefined
    if (packetId) {
      await this.client_.cancelPacket(packetId)
    }
  }
```

- [ ] **Step 4: Run; verify pass.** → PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @medusa-cz/fulfillment-packeta typecheck
git add packages/fulfillment-packeta/src/providers/packeta
git commit -s -m "feat(packeta): createFulfillment (COD + external) + cancelFulfillment (TDD)"
```

---

## Task 10: Provider — returns + label documents

**Files:**

- Modify: `packages/fulfillment-packeta/src/providers/packeta/service.ts`
- Modify: `packages/fulfillment-packeta/src/providers/packeta/__tests__/service.test.ts`

**Interfaces:**

- Produces: `createReturnFulfillment(fulfillment): Promise<{ data: Record<string, unknown>; labels: never[] }>`, `getShipmentDocuments(data): Promise<Array<{ type: string; base64: string; mime: string }>>`, `retrieveDocuments(fulfillmentData, documentType): Promise<Array<{ type: string; base64: string; mime: string }>>`.

- [ ] **Step 1: Add failing tests**

```ts
describe("createReturnFulfillment", () => {
  it("creates a return packet claim and stores its id", async () => {
    createPacketClaim.mockResolvedValue({ id: "77", barcode: "Z77" })
    const res = await makeProvider().createReturnFulfillment({
      data: { packet_id: "900719925474099", pickup_point_id: "79" },
    } as never)
    expect(createPacketClaim).toHaveBeenCalled()
    expect(res.data).toMatchObject({ return_packet_id: "77", return_barcode: "Z77" })
  })
})

describe("label documents", () => {
  it("getShipmentDocuments returns the label PDF (base64) for the stored packet", async () => {
    packetLabelPdf.mockResolvedValue("JVBERi0xLjQK")
    const docs = await makeProvider().getShipmentDocuments({ packet_id: "1" })
    expect(packetLabelPdf).toHaveBeenCalledWith("1", "A6 on A4")
    expect(docs).toEqual([{ type: "label", base64: "JVBERi0xLjQK", mime: "application/pdf" }])
  })

  it("uses a configured labelFormat", async () => {
    packetLabelPdf.mockResolvedValue("X")
    await makeProvider({ ...options, labelFormat: "A7 on A4" }).getShipmentDocuments({
      packet_id: "1",
    })
    expect(packetLabelPdf).toHaveBeenCalledWith("1", "A7 on A4")
  })

  it("returns [] when there is no packet id", async () => {
    expect(await makeProvider().getShipmentDocuments({})).toEqual([])
  })
})
```

- [ ] **Step 2: Run; verify fail.** → FAIL.

- [ ] **Step 3: Implement (append to the provider)**

```ts
  async createReturnFulfillment(
    fulfillment: Record<string, any>
  ): Promise<{ data: Record<string, unknown>; labels: never[] }> {
    const src = (fulfillment?.data ?? {}) as Record<string, unknown>
    const claim = await this.client_.createPacketClaim({
      number: `ret-${src.packet_id ?? Date.now()}`,
      addressId: src.pickup_point_id,
      eshop: this.options_.eshop,
    })
    return {
      data: { ...src, return_packet_id: claim.id, return_barcode: claim.barcode },
      labels: [],
    }
  }

  private async labelDocuments(
    data: Record<string, unknown>
  ): Promise<Array<{ type: string; base64: string; mime: string }>> {
    const packetId = data.packet_id as string | undefined
    if (!packetId) {
      return []
    }
    const base64 = await this.client_.packetLabelPdf(
      packetId,
      this.options_.labelFormat ?? "A6 on A4"
    )
    return [{ type: "label", base64, mime: "application/pdf" }]
  }

  async getShipmentDocuments(data: Record<string, unknown>) {
    return this.labelDocuments(data)
  }

  async retrieveDocuments(fulfillmentData: Record<string, unknown>, _documentType: string) {
    return this.labelDocuments(fulfillmentData)
  }
```

- [ ] **Step 4: Run; verify pass.** → PASS. Whole package: `pnpm --filter @medusa-cz/fulfillment-packeta test` → all unit suites green.

- [ ] **Step 5: Typecheck + build + commit**

```bash
pnpm --filter @medusa-cz/fulfillment-packeta typecheck
pnpm --filter @medusa-cz/fulfillment-packeta build
git add packages/fulfillment-packeta/src/providers/packeta
git commit -s -m "feat(packeta): returns + label documents (TDD); provider complete"
```

---

## Task 11: Admin API routes — close-batch + tracking-refresh; opt-in live suite

**Files:**

- Create: `packages/fulfillment-packeta/src/api/admin/packeta/close-batch/route.ts`
- Create: `packages/fulfillment-packeta/src/api/admin/packeta/tracking/[packetId]/route.ts`
- Create: `packages/fulfillment-packeta/src/__tests__/integration/packeta-live.test.ts`

> These routes resolve the fulfillment module and instantiate a `PacketaClient` from the registered provider options. They are thin orchestration over the already-tested client, so they are verified by typecheck/build + the manual acceptance, not new unit tests.

- [ ] **Step 1: close-batch route**

`src/api/admin/packeta/close-batch/route.ts`:

```ts
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
```

> **Wiring note [Medium]:** for an admin route that should read the provider's configured `apiPassword` from the container instead of the request body, resolve `Modules.FULFILLMENT` and read the provider options during Task 12 integration. Body-passed `apiPassword` keeps M2a self-contained; tighten in M2b/demo if desired.

- [ ] **Step 2: tracking route**

`src/api/admin/packeta/tracking/[packetId]/route.ts`:

```ts
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PacketaClient } from "../../../../../core/packeta-client.js"

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const packetId = req.params.packetId
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
```

- [ ] **Step 3: opt-in live suite (auto-skips without creds)**

`src/__tests__/integration/packeta-live.test.ts`:

```ts
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
```

- [ ] **Step 4: Verify the live suite SKIPS without env; typecheck + build**

Run: `pnpm --filter @medusa-cz/fulfillment-packeta test:integration` → suite skipped (0 failures).
Run: `pnpm --filter @medusa-cz/fulfillment-packeta typecheck && pnpm --filter @medusa-cz/fulfillment-packeta build` → green (routes compile).

- [ ] **Step 5: Commit**

```bash
git add packages/fulfillment-packeta/src/api packages/fulfillment-packeta/src/__tests__/integration
git commit -s -m "feat(packeta): admin close-batch + tracking routes; opt-in live suite (TDD)"
```

---

## Task 12: Register in the demo backend + seed CZK region & pickup-point option

**Files:**

- Modify: `apps/backend/medusa-config.ts`
- Modify: `apps/backend/.env.template`
- Create: `apps/backend/src/scripts/seed-packeta.ts`

- [ ] **Step 1: Read the current config**

Run: `cat apps/backend/medusa-config.ts` — note the existing `modules` array (and whether a Fulfillment module is already configured; merge into its `providers` if so).

- [ ] **Step 2: Register the provider in the Fulfillment module**

Add to `modules` (merge with any existing `@medusajs/medusa/fulfillment` entry — it already has the `manual` provider; append ours):

```ts
{
  resolve: "@medusajs/medusa/fulfillment",
  options: {
    providers: [
      {
        resolve: "@medusa-cz/fulfillment-packeta",
        id: "packeta",
        options: {
          apiKey: process.env.PACKETA_API_KEY,
          apiPassword: process.env.PACKETA_API_PASSWORD,
          eshop: process.env.PACKETA_ESHOP,
          defaultCurrency: "CZK",
          validatePointServerSide: process.env.PACKETA_VALIDATE_POINT !== "false",
          priceTable: {
            cz: { bands: [{ maxWeight: 5, price: 79 }, { maxWeight: 10, price: 99 }], codSurcharge: 30, freeOver: 1500 },
          },
        },
      },
    ],
  },
},
```

Add to `.env.template`: `PACKETA_API_KEY=`, `PACKETA_API_PASSWORD=`, `PACKETA_ESHOP=`, `PACKETA_VALIDATE_POINT=true`.

- [ ] **Step 3: Seed script — CZK region + service zone + calculated pickup-point shipping option (idempotent)**

`apps/backend/src/scripts/seed-packeta.ts`:

```ts
import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

export default async function seedPacketa({ container }: ExecArgs) {
  const logger = container.resolve("logger")
  const region = container.resolve(Modules.REGION)
  const fulfillment = container.resolve(Modules.FULFILLMENT)

  const regions = await region.listRegions({ name: "Czechia" })
  if (!regions.length) {
    await region.createRegions([{ name: "Czechia", currency_code: "czk", countries: ["cz"] }])
    logger.info("Created Czechia (CZK) region.")
  } else {
    logger.info("Czechia region already exists; skipping region create.")
  }

  // Fulfillment set + service zone + calculated shipping option bound to the packeta provider.
  const existingSets = await fulfillment.listFulfillmentSets({ name: "packeta-set" })
  if (existingSets.length) {
    logger.info("packeta-set already exists; skipping fulfillment seed.")
    return
  }
  const set = await fulfillment.createFulfillmentSets({
    name: "packeta-set",
    type: "shipping",
    service_zones: [{ name: "CZ", geo_zones: [{ type: "country", country_code: "cz" }] }],
  })
  await fulfillment.createShippingOptions([
    {
      name: "Packeta pickup point",
      service_zone_id: set.service_zones[0].id,
      shipping_profile_id: (await fulfillment.listShippingProfiles({}))[0]?.id,
      provider_id: "fp_packeta_packeta",
      price_type: "calculated",
      type: { label: "Packeta", description: "Pickup point", code: "packeta" },
      data: { id: "packeta-pickup" },
    },
  ])
  logger.info("Created Packeta service zone + calculated shipping option.")
}
```

> **[Medium] — confirm during execution:** the composed provider id is `fp_{identifier}_{id}` → `fp_packeta_packeta` (research §A1). The exact `createShippingOptions` field set (esp. `shipping_profile_id`, `type`) may need adjustment against the running 2.17 admin — run the seed and read any validation error. This is the same "confirm against the live module" discipline used in comgate Task 9.

- [ ] **Step 4: Build the backend to confirm the provider loads**

Run: `pnpm --filter @medusa-cz/demo build`
Expected: green (the package resolves, config compiles, `.js`-extension build loads the provider). Live registration is exercised by the integration test (Task 13) and manual acceptance (Task 14).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/medusa-config.ts apps/backend/.env.template apps/backend/src/scripts/seed-packeta.ts
git commit -s -m "feat(demo): register Packeta fulfillment provider + CZK region/option seed"
```

---

## Task 13: Integration test — provider loads under Medusa

**Files:**

- Create: `packages/fulfillment-packeta/src/__tests__/integration/packeta-provider.test.ts`

> Mirrors comgate's integration check: prove the built provider is registrable and `getFulfillmentOptions` resolves. Uses `@medusajs/test-utils`; no network.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest"
import PacketaProviderService from "../../providers/packeta/service"

describe("Packeta provider registration", () => {
  const options = {
    apiKey: "KEY",
    apiPassword: "PW",
    priceTable: { cz: { bands: [{ maxWeight: 5, price: 79 }] } },
  }

  it("has the static identifier `packeta`", () => {
    expect(PacketaProviderService.identifier).toBe("packeta")
  })

  it("constructs and lists the configured fulfillment option", async () => {
    const provider = new PacketaProviderService({} as never, options as never)
    const opts = await provider.getFulfillmentOptions()
    expect(opts[0]).toMatchObject({ id: "packeta-pickup" })
  })

  it("isFulfillmentService recognizes the class", () => {
    expect(
      (PacketaProviderService as never as { _isFulfillmentService: boolean })._isFulfillmentService
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Run; verify pass**

Run: `pnpm --filter @medusa-cz/fulfillment-packeta test:integration`
Expected: PASS (3 cases). (The opt-in live suite still skips.)

- [ ] **Step 3: Commit**

```bash
git add packages/fulfillment-packeta/src/__tests__/integration/packeta-provider.test.ts
git commit -s -m "test(packeta): integration — provider registers + lists options"
```

---

## Task 14: README, manual acceptance, whole-repo green, PR

**Files:**

- Modify: `packages/fulfillment-packeta/README.md`

- [ ] **Step 1: Write the README** — install, register, options table, and manual acceptance:

````md
# @medusa-cz/fulfillment-packeta

Packeta (Zásilkovna) pickup-point fulfillment provider for MedusaJS 2.17 (Czech market).
Calculated pricing, packet create/cancel, returns, label PDFs, close-batch, and tracking.
Storefront pickup-point selection (Widget v6) is provided by the M2b storefront integration.

## Install

```bash
pnpm add @medusa-cz/fulfillment-packeta
```

## Register (`medusa-config.ts`)

```ts
{
  resolve: "@medusajs/medusa/fulfillment",
  options: { providers: [
    { resolve: "@medusa-cz/fulfillment-packeta", id: "packeta",
      options: {
        apiKey: process.env.PACKETA_API_KEY,        // public — widget + pickup-point REST
        apiPassword: process.env.PACKETA_API_PASSWORD, // secret — main API (server-only)
        eshop: process.env.PACKETA_ESHOP,           // sender indication / test sender
        defaultCurrency: "CZK",
        validatePointServerSide: true,
        priceTable: { cz: { bands: [{ maxWeight: 5, price: 79 }, { maxWeight: 10, price: 99 }], codSurcharge: 30, freeOver: 1500 } },
      } },
  ] },
}
```

Composed provider id: `fp_packeta_packeta`.

## Options

| Option                  | Required | Default  | Notes                                             |
| ----------------------- | -------- | -------- | ------------------------------------------------- |
| apiKey                  | yes      | —        | Public API key (widget + pickup-point REST)       |
| apiPassword             | yes      | —        | Secret API password (main API; server-only)       |
| eshop                   | no       | —        | Sender indication; use a test sender for testing  |
| priceTable              | yes      | —        | Country × weight bands, COD surcharge, free-over  |
| defaultCurrency         | no       | CZK      | COD currency                                      |
| validatePointServerSide | no       | true     | Validate the chosen point via the widget endpoint |
| labelFormat             | no       | A6 on A4 | `packetLabelPdf` format                           |

## Manual acceptance

1. `export PACKETA_API_KEY=… PACKETA_API_PASSWORD=… PACKETA_ESHOP=<test-sender>`.
2. Start Postgres; `cd apps/backend && pnpm dev`; run the seed: `npx medusa exec ./src/scripts/seed-packeta.ts`.
3. (M2b) Run the storefront, add a product to the CZK cart → checkout → pick a Packeta point → place order.
4. Admin: a packet is created; print the label (fulfillment documents), refresh tracking, and close-batch.
5. Exercise a COD order and an external-carrier point. Cancel a test packet to clean up.

> No Packeta sandbox exists. The opt-in live suite (`PACKETA_API_PASSWORD` + `PACKETA_ESHOP`) runs
> `createPacket → packetStatus → cancelPacket` and **never** `createShipment` (no charge until hand-over).
````

- [ ] **Step 2: Whole-repo gate**

Run: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`
Expected: all green. `pnpm test` now includes the Packeta client + pricing + provider + integration suites (the live suite skips). (Skip local `format:check` — Windows CRLF false positives; CI on Linux/LF is authoritative.)

- [ ] **Step 3: Commit + push + open PR**

```bash
git add packages/fulfillment-packeta/README.md
git commit -s -m "docs(packeta): README + manual acceptance"
git push -u origin m2a-packeta-backend
gh pr create --base master --title "M2a: Packeta fulfillment provider (backend)" \
  --body "Implements the Packeta backend per docs/superpowers/plans/2026-06-29-m2a-packeta-backend.md. Hermetic, mocked-HTTP CI gate. Storefront Widget is M2b."
```

- [ ] **Step 4: Watch CI green, then merge**

Run: `gh pr checks --watch`
Expected: `build/typecheck/lint/test` + DCO pass. Merge when green.

---

## Self-Review

**Spec coverage** (against `2026-06-29-m2-packeta-design.md`):

- M2-1 REST/XML transport → Task 3 (`call()` builds method-named XML, apiPassword first). ✓
- M2-2 country×weight pricing + COD + free-over → Task 2 (pure) + Task 7 (`calculatePrice` wiring). ✓
- M2-3 labels via document methods → Task 10 (`getShipmentDocuments`/`retrieveDocuments`). ✓
- M2-4 COD → Task 9 (`cod`/`currency` on createPacket) + Task 2 surcharge. ✓
- M2-5 external-carrier points → Task 8 (normalize) + Task 9 (`addressId=carrier_id`, `carrierPickupPoint`). ✓
- M2-6 returns → Task 5 (client) + Task 10 (`createReturnFulfillment`). ✓
- M2-7 close-batch → Task 5 (`createShipment`) + Task 11 (admin route). ✓
- M2-8 tracking sync → Task 4 (`packetStatus`/`packetTracking`) + Task 11 (tracking route). ✓
- M2-9 server-side validation → Task 6 (client) + Task 8 (wired, default on, off in tests). ✓
- M2-10 split → this is M2a; M2b is the storefront plan. ✓
- Packaging `.js` pitfall (P1) → Task 1 Step 4. ✓
- §4 config/validateOptions → Task 7 `validateOptions`. ✓
- §7 testing (mocked gate + opt-in live, never createShipment) → Tasks 2–10 + Task 11. ✓
- §5 demo wiring → Task 12. ✓

**Placeholder scan:** No "TBD"/"add error handling". Four explicit "[Medium] — confirm during execution" notes (Packeta XML envelope shape; `calculatePrice`/`createFulfillment` context paths; `createShippingOptions` field set; admin-route credential source). Each states exactly what to check, the default to keep, and why it's centralized so only one place changes. Same discipline as comgate's "confirm during execution" notes; the integration test + build catch drift.

**Type consistency:** `PacketaClient` methods (`createPacket`/`cancelPacket`/`packetStatus`/`packetTracking`/`packetLabelPdf`/`createShipment`/`createPacketClaim`/`senderGetReturnRouting`) consistent across Tasks 3–5 tests, the provider (Tasks 7–10), and the admin routes (Task 11). `PacketaPointData`/`PacketaFulfillmentData` field names (`pickup_point_id`, `pickup_point_type`, `carrier_id`, `carrier_pickup_point_id`, `packet_id`, `barcode`) consistent across `validateFulfillmentData`, `createFulfillment`, and label methods. `calculateShippingPrice(table, country, weightKg, ctx)` signature identical in Task 2 and Task 7. `static identifier = "packeta"` → `fp_packeta_packeta` used in seed (Task 12) and integration test (Task 13).

**Out of scope (held):** ZPL/batch labels, B2B packets, scheduled delivery, adult-content, barcode PNG, daily catalog REST export, `@medusa-cz/shared` extraction.
