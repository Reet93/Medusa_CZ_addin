# M2 — Packeta (Zásilkovna) fulfillment provider (`@medusa-cz/fulfillment-packeta`)

> Design spec. Brainstormed 2026-06-29. Status: approved, pre-plan.
> Grounds: `docs/superpowers/specs/2026-06-13-medusa-cz-architecture-design.md` (§5.2, §7, §9),
> `docs/superpowers/research/2026-06-29-packeta-fulfillment-verification.md` (the M2 docs-gate —
> Medusa 2.17 `AbstractFulfillmentProviderService`, Packeta REST/XML + SOAP API, Widget v6).
> Confidence tags per `local.md` §2: **[High]** verified · **[Medium]** reasoned/unverified · **[Low]** guess.

## Goal

Turn the M0 `fulfillment-packeta` skeleton into a working Packeta pickup-point fulfillment provider
for MedusaJS **2.17.0**, covering the full pickup-point flow: point selection (storefront Widget v6),
calculated shipping price, packet creation/cancellation, returns, label PDFs, batch hand-over, and
tracking sync. The provider half is proven hermetically by mocked-HTTP unit tests (blocking CI gate);
the storefront half is proven by a manual demo round-trip. This is the milestone that proves the
fulfillment-provider archetype (architecture spec §9, M2).

## Approach (chosen)

**A — Own thin REST/XML client + provider service + pure pricing unit.** A self-contained Packeta
client (REST/XML transport) lives in the package; the provider service maps Medusa's fulfillment
contract onto it; shipping price is a pure function over a configured price table. Rejected: (B) the
`soap` npm package against the official WSDL — heavier dependency and PHP-flavoured 64-bit-id quirks
the docs warn about, for an identical method set (research §B); (C) extracting a shared fulfillment
base into `@medusa-cz/shared` now — premature (one data point; rule of three).

**Transport = REST/XML** [High]: POST an XML body (root element = method name) to
`https://www.zasilkovna.cz/api/rest`; `fetch` + a small XML builder/parser (`fast-xml-parser`). Same
methods/fields as SOAP, no SOAP stack. (Research §B.)

## Plan split (two implementation plans, one spec)

The scope spans a hermetic backend and a browser-dependent storefront, so M2 is built as two plans:

- **M2a — Backend provider (CI-gated, hermetic).** Client, pricing, provider service (all contract
  methods incl. returns + label documents), server-side point validation, admin API routes for
  close-batch + tracking sync, optional scheduled tracking job, demo region/shipping-option seed.
  Fully unit-testable with mocked HTTP → the blocking CI gate. Lands green independent of the storefront.
- **M2b — Storefront Widget v6 + checkout (integration/manual).** The `Packeta.Widget.pick` React
  component, checkout pickup-point selection, and the `addShippingMethod` `data` round-trip. Acceptance
  is the manual demo round-trip (needs the storefront running), exactly like comgate's M1-3.

## Decisions (this session)

| #     | Decision                                                                                        | Confidence | Notes                                                                                                                     |
| ----- | ----------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| M2-1  | **Transport = REST/XML** (`/api/rest`, XML body), not SOAP                                      | [High]     | Avoids PHP `SoapClient` 64-bit-id quirks; `fetch` + `fast-xml-parser`. Identical method set to SOAP (research §B).        |
| M2-2  | **Pricing = country × weight price table**, + COD surcharge + free-over-threshold               | [High]     | No live Packeta rate API; `calculatePrice` computes from config. Pure function → ideal TDD seam (research §B1, §E2).      |
| M2-3  | **Labels via provider document methods** (`getShipmentDocuments`/`retrieveDocuments`)           | [High]     | `packetLabelPdf` → base64 PDF surfaced through Medusa's native fulfillment document UI.                                   |
| M2-4  | **COD (dobírka) IN scope**                                                                      | [High]     | Map cart COD → Packeta `cod`/`value`/`currency`; whole-number for CZK, ×5 for HUF (research §B1).                         |
| M2-5  | **External-carrier points IN scope**                                                            | [High]     | `pickupPointType="external"` → `addressId = carrierId`, `carrierPickupPoint = carrierPickupPointId` (research §B1).       |
| M2-6  | **Returns flow IN scope**                                                                       | [High]     | `createReturnFulfillment` → `createPacketClaimWithPassword` / `senderGetReturnRouting` (research §B1).                    |
| M2-7  | **createShipment / close-batch IN scope** (admin action)                                        | [High]     | Hands created packets to Packeta (expedition). **Never invoked on test packets** — mocked-HTTP unit tests only.           |
| M2-8  | **Tracking / status sync IN scope** (polling)                                                   | [High]     | Manual admin "refresh status" route over `packetStatus`/`packetTracking`; optional scheduled job. No push webhook.        |
| M2-9  | **Server-side pickup-point validation IN scope**, behind `validatePointServerSide` (default on) | [High]     | Validate via `…/v6/pps/api/widget/v1/validate` in `validateFulfillmentData`; off in tests for hermeticity (research §C1). |
| M2-10 | **Two-plan split (M2a backend / M2b storefront)**                                               | [High]     | Backend hermetic + CI-gated; storefront manual. Mirrors comgate M1-3.                                                     |

## 1. Package structure — [High]

```
packages/fulfillment-packeta/src/
├── providers/packeta/
│   ├── index.ts          # ModuleProvider(Modules.FULFILLMENT, { services: [PacketaProviderService] })
│   └── service.ts        # extends AbstractFulfillmentProviderService; maps methods → client + pricing
├── core/
│   ├── packeta-client.ts # REST/XML: createPacket, cancelPacket, packetStatus, packetTracking,
│   │                     #   packetLabelPdf, createShipment, createPacketClaimWithPassword, senderGetReturnRouting
│   ├── widget-validate.ts# POST …/v6/pps/api/widget/v1/validate (server-side point validation)
│   ├── pricing.ts        # country × weight price table → calculatePrice (PURE, no HTTP)
│   └── __tests__/        # vitest, HTTP mocked — part of the CI gate
├── api/admin/            # routes: close-batch (createShipment), refresh-tracking (packetStatus/Tracking)
├── jobs/                 # (optional) scheduled tracking sync
├── widgets/pickup-point/ # Widget v6 React component (Packeta.Widget.pick) — storefront (M2b)
├── types.ts              # options, price table, Point data, PacketAttributes, status maps
├── index.ts              # barrel
└── __tests__/integration/# @medusajs/test-utils (Jest): provider loads + getFulfillmentOptions resolves
```

The HTTP client stays in-package (architecture §8). `@medusa-cz/shared` is not touched in M2.

**Packaging pitfall P1 (fix first) — [High]:** the skeleton's `providers/packeta/index.ts` and `index.ts`
use extensionless relative imports (`from "./service"`). Medusa builds to ESM under `.medusa/server`;
extensionless relative imports fail to resolve at runtime — the exact bug PR #3 fixed for comgate. **All
relative value-imports must carry `.js`** (`from "./service.js"`, `from "../../core/packeta-client.js"`,
etc.). Package-name imports (`@medusajs/framework/utils`) take no extension. (Research §D1.)

## 2. Provider method → Packeta mapping — [High] (Medusa contract) / [High] (Packeta calls, research §B1)

Medusa 2.17 `AbstractFulfillmentProviderService` methods are **non-abstract** (base throws / returns `[]`);
we override exactly these:

- **getFulfillmentOptions** → the pickup-point shipping option(s) defined in config (`{ id, name }`).
- **validateFulfillmentData(optionData, data, context)** → normalize the chosen point from `data`; if
  `validatePointServerSide`, call the widget validate endpoint; persist `pickup_point_id` (+ display
  fields, `pickupPointType`, and `carrierId`/`carrierPickupPointId` for external points) onto `data`.
  Reject if the point is missing/invalid — never trust the raw client payload.
- **validateOption(data)** → confirm the option id exists in config.
- **canCalculate(data)** → `true` (calculated pricing).
- **calculatePrice(optionData, data, context)** → `pricing.ts`: destination country (from cart shipping
  address in `context`) × total weight band → base amount, + COD surcharge if COD, − to 0 if order total
  ≥ free-over threshold. Returns `{ calculated_amount, is_calculated_price_tax_inclusive }`.
- **createFulfillment(data, items, order, fulfillment)** → build `PacketAttributes`
  (`number` = order id, `name`/`surname`, `email`/`phone`, `value`, `weight`, COD `cod`+`currency`,
  `eshop` = sender; internal → `addressId = pickup_point_id`; external → `addressId = carrierId`,
  `carrierPickupPoint = carrierPickupPointId`) → `createPacket` → store `{ packet_id, barcode }` on
  fulfillment `data`. Returns `CreateFulfillmentResult` (`{ data, labels: [] }`).
- **cancelFulfillment(data)** → `cancelPacket(packet_id)`.
- **createReturnFulfillment(fulfillment)** → `createPacketClaimWithPassword` (+ `senderGetReturnRouting`
  as needed) → store return packet info.
- **getShipmentDocuments(data)** / **retrieveDocuments(data, type)** → `packetLabelPdf(packet_id, format)`
  → return `[{ type: "label", base64, mime: "application/pdf" }]`.

**Not part of the contract** → live as plugin admin API routes (resolve the provider/client):

- **close-batch** → `createShipment(packetIds)` over not-yet-handed-over packets.
- **refresh-tracking** → `packetStatus`/`packetTracking(packet_id)` → reflect status on the order;
  optional `jobs/` scheduled sync.

**Packet id discipline — [High]:** Packeta `packetId` is `unsignedLong` (64-bit). **Treat as a string**
end-to-end to avoid JS number truncation (research §B1).

## 3. Pickup-point + fulfillment data flow — [High] (research §A3, §C)

1. Storefront checkout renders the Widget (M2b) → customer picks a point → callback yields a `Point`.
2. Widget stores `point.id` (+ display fields, type, external carrier ids) into the cart shipping-method
   `data` via `addShippingMethod(cartId, { option_id, data })`.
3. `validateFulfillmentData` validates/normalizes that `data` (optionally server-validated) and persists it.
4. `calculatePrice` prices the option (country × weight + COD).
5. At fulfillment, `createFulfillment` reads `data` → `createPacket` → stores `packet_id`/`barcode`.
6. Admin: print label (`getShipmentDocuments`), close-batch (`createShipment`), refresh tracking.
7. Returns: `createReturnFulfillment` → `createPacketClaimWithPassword`.

## 4. Config / `validateOptions` — [High]

Provider options: `apiKey` (public — widget + pickup-point REST), `apiPassword` (secret — main API),
`eshop` (sender indication / test sender), `priceTable` (country × weight bands, COD surcharge,
free-over threshold), `defaultCurrency` (default `CZK`), `validatePointServerSide` (bool, default `true`),
`labelFormat` (default e.g. `A6 on A4`). `validateOptions` throws if `apiKey` or `apiPassword` is missing.
**Two-secrets discipline:** `apiPassword` is server-only and never reaches the storefront; the widget
uses `apiKey` only (research §B).

Registration (architecture §5.2, research §D):

```ts
{ resolve: "@medusajs/medusa/fulfillment",
  options: { providers: [ { resolve: "@medusa-cz/fulfillment-packeta", id: "packeta",
    options: { apiKey, apiPassword, eshop, defaultCurrency: "CZK", priceTable, validatePointServerSide: true } } ] } }
```

## 5. Storefront demo wiring (M2b round-trip) — [Medium]

- `apps/backend/medusa-config.ts`: register `@medusa-cz/fulfillment-packeta` (id `packeta`) from env;
  seed a CZK region + a calculated pickup-point shipping option bound to the provider.
- `apps/storefront`: add the Widget v6 component to the checkout delivery step — load `library.js`, call
  `Packeta.Widget.pick(apiKey, cb, opts)`, on selection write `point` fields into the shipping-method
  `data`; show the chosen point. Exact starter hooks (delivery step, `setShippingMethod`) verified in planning.

## 6. Error handling — [Medium]

`packeta-client` normalizes non-OK HTTP and Packeta XML faults (`PacketAttributesFault`,
`IncorrectApiPasswordFault`, `CancelNotAllowedFault`, …) into a typed `PacketaError`; the provider
surfaces Medusa-friendly errors. Network/5xx tagged retryable. Server-side point validation maps the
widget validate `errors[]` (`NotFound`, `PickupPointForbidden`, `NoCashOnDelivery`, …) to clear messages.

## 7. Testing & acceptance — [High]

- **TDD, RED → GREEN → REFACTOR.** Mocked-HTTP unit tests cover the client (all methods), `pricing.ts`
  (exhaustive country/weight/COD/free-over cases), and every provider method (incl. returns + labels +
  external-carrier mapping + COD). **Blocking CI gate; no secrets.**
- **No Packeta sandbox exists** (research §B). Optional opt-in live suite (`__tests__/integration/`, gated
  on `PACKETA_API_KEY`/`PACKETA_API_PASSWORD`) may run `createPacket` (test `eshop` sender) → `packetStatus`
  → `cancelPacket`. **Never `createShipment`** (no charge until physical hand-over). Auto-skipped without
  env; never blocks PR CI.
- **Manual acceptance (M2b):** Postgres + backend + storefront → pick a point in the widget → checkout →
  order placed with a packet created; print label, refresh tracking, and close-batch from admin; exercise
  a COD order and an external-carrier point.

## 8. Vendor docs-gate

Completed: `docs/superpowers/research/2026-06-29-packeta-fulfillment-verification.md` (Medusa 2.17 contract,
REST/XML + SOAP method set + `PacketAttributes`, Widget v6 `Point`/`Options` + validate endpoint, packaging).
Re-verify against the cited sources if implementation conflicts. Carry-in items still [Medium]:
`value`/`cod`/`weight` units + currency vs Medusa `BigNumberInput` (major-unit) — confirm before money flows.

## 9. Out of scope (YAGNI) — [High]

ZPL/thermal labels (`packetLabelZpl`), multi-packet batch label PDF (`packetsLabelsPdf`), B2B packets
(`createPacketsB2B`), scheduled delivery (`deliverOn`), adult-content handover (`adultContent`), barcode
PNG, daily pickup-point catalog REST export (v5), multi-tenant credentials. Extracting a shared
fulfillment base into `@medusa-cz/shared` waits for a second fulfillment provider (rule of three).

## Acceptance summary

- M2a: all provider + client + pricing unit tests green (mocked; COD, external-carrier, returns, labels)
  — blocking CI gate. Built plugin loads in the demo (`.js` extensions; provider resolves).
- Opt-in live suite passes when `PACKETA_*` creds are supplied (createPacket → status → cancel; never createShipment).
- M2b: a real storefront round-trip places an order with a packet created; label print, tracking refresh,
  and close-batch succeed from admin.
- No business logic leaks outside the package; `@medusa-cz/shared` unchanged.
