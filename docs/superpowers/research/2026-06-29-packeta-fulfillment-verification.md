# M2 docs-gate — Packeta (Zásilkovna) fulfillment + Medusa 2.17 fulfillment internals (verified)

> Vendor docs-gate for the M2 spec (§5.2). Verified 2026-06-29 against live sources (not memory):
> Medusa source at the **v2.17.0** git tag, `docs.medusajs.com`, GitHub issue tracker, and the
> Packeta API docs (`docs.packeta.com` / static mirror + official Zasilkovna plugin source).
> Confidence per `local.md` §2. If implementation conflicts with this doc, re-verify against the cited source.
>
> Builds on `2026-06-14-medusa-2.15-verification.md` §4/§5 (the 2.15 fulfillment facts) and re-checks
> them at **2.17.0** — the version the repo is now pinned to (`packages/*/package.json` all on `2.17.0`).

---

## PART A — Medusa 2.17 fulfillment-provider internals

### A1. `AbstractFulfillmentProviderService` contract (2.17.0) — [High]

Import: `import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils"`.
**Crucial difference vs the payment provider:** the methods are **NOT `abstract`**. The base class
provides a body for every method — most `throw "Method not implemented"`, the three document-getters
return `[]`. So a provider compiles even if it overrides nothing; you override only what you use.
Verified verbatim against `packages/core/utils/src/fulfillment/provider.ts` @ `v2.17.0` (identical in
shape to 2.15 — no contract change across 2.15→2.17).

Statics / provided:

```ts
static identifier: string
static _isFulfillmentService = true
static isFulfillmentService(obj): boolean
getIdentifier(): string                      // returns (this.constructor as any).identifier
```

Overridable instance methods (signatures verbatim from v2.17.0 source):

```ts
// throw "not implemented" by default — override these for a real provider
getFulfillmentOptions(): Promise<FulfillmentOption[]>
validateFulfillmentData(optionData: Record<string, unknown>, data: Record<string, unknown>,
                        context: ValidateFulfillmentDataContext): Promise<any>
validateOption(data: Record<string, unknown>): Promise<boolean>
canCalculate(data: CreateShippingOptionDTO): Promise<boolean>
calculatePrice(optionData: CalculateShippingOptionPriceDTO["optionData"],
               data: CalculateShippingOptionPriceDTO["data"],
               context: CalculateShippingOptionPriceDTO["context"]): Promise<CalculatedShippingOptionPrice>
createFulfillment(data: Record<string, unknown>,
                  items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
                  order: Partial<FulfillmentOrderDTO> | undefined,
                  fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
                 ): Promise<CreateFulfillmentResult>
cancelFulfillment(data: Record<string, unknown>): Promise<any>
createReturnFulfillment(fulfillment: Record<string, unknown>): Promise<CreateFulfillmentResult>
retrieveDocuments(fulfillmentData: Record<string, unknown>, documentType: string): Promise<void>

// default body returns [] — override only if you serve documents
getFulfillmentDocuments(data: Record<string, unknown>): Promise<never[]>
getReturnDocuments(data: Record<string, unknown>): Promise<never[]>
getShipmentDocuments(data: Record<string, unknown>): Promise<never[]>
```

**Required vs optional for Packeta** (Medusa never _enforces_ these — "required" = needed for the feature to work):

| Method                                | Needed for Packeta?                  | Why                                                                              |
| ------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------- |
| `getFulfillmentOptions`               | **Required**                         | Admin lists shipping options from this (the only one the M0 skeleton overrides). |
| `validateFulfillmentData`             | **Required**                         | Validates + persists the chosen pickup-point onto the shipping-method `data`.    |
| `validateOption`                      | Recommended                          | Validates option config at create-shipping-option time. Default throws.          |
| `canCalculate`                        | **Required (if calculated pricing)** | Must return `true` so Medusa calls `calculatePrice`.                             |
| `calculatePrice`                      | **Required (if calculated pricing)** | Returns the rate (`{ calculated_amount, is_calculated_price_tax_inclusive }`).   |
| `createFulfillment`                   | **Required**                         | Calls Packeta `createPacket` → stores packet id/barcode on fulfillment `data`.   |
| `cancelFulfillment`                   | **Required**                         | Calls Packeta `cancelPacket`.                                                    |
| `createReturnFulfillment`             | Optional                             | Only if return labels are in scope (M2 likely out of scope).                     |
| `get*Documents` / `retrieveDocuments` | Optional                             | Label-PDF retrieval can live here OR in a custom API route (see C2).             |

`CalculatedShippingOptionPrice` = `{ calculated_amount: number; is_calculated_price_tax_inclusive: boolean }`
(`packages/core/types/src/fulfillment/common.ts`). `FulfillmentOption` is an open record with a required
`id` plus arbitrary keys (`{ id: string; name?: string; ... }`).
Sources: https://github.com/medusajs/medusa/blob/v2.17.0/packages/core/utils/src/fulfillment/provider.ts ,
https://docs.medusajs.com/resources/references/fulfillment/provider

### A2. The `canCalculate` / `calculatePrice` bug — #9495 / #9598 — FIXED, confirmed at 2.17.0 [High]

This was the explicit M2 open question. Status:

- **Discussion #9495** — `https://github.com/medusajs/medusa/discussions/9495`. This is a **GitHub Discussion**, not an Issue (querying it as an issue via `gh` returns "Could not resolve to an issue"). It is the original community report that calculated fulfillment pricing didn't work in v2.
- **Issue #9598** — "Shipping Options Service Missing, canCalculate is never called." **State: CLOSED, reason: COMPLETED, closedAt: 2024-12-24T15:03:14Z** (verified via `gh issue view 9598 --repo medusajs/medusa`). The `closedByPullRequestsReferences` array is empty, so GitHub doesn't expose a single auto-linked closing PR — fix-PR precision is therefore **[Medium]**, but the _outcome_ is verified directly in source (below).
- **The bug:** during the v1→v2 refactor the wiring that called a fulfillment provider's `canCalculate` / `calculatePrice` was dropped. In v1 this lived in `services/shipping-options.ts` (`validatePriceType_` / `validateAndMutatePrice`); in early v2 those paths were not reimplemented, so a calculated option (`price_type: "calculated"`, `amount: null`) errored/returned no price on `GET /store/shipping-options` instead of being priced.
- **Fix verified present at v2.17.0:** the cart flow `list-shipping-options-for-cart-with-pricing.ts` splits options by `price_type` (`ShippingOptionPriceType.FLAT` → `flatRateShippingOptionIds`, else → `calculatedShippingOptionIds`), queries them separately via `parallelize()`, builds a `CalculateShippingOptionPriceDTO` with provider context, and runs `calculateShippingOptionsPricesStep` (→ provider `calculatePrice`); the calculated result is merged back as `calculated_price`. Dynamic/calculated pricing originally landed in **v2.1.1 (Dec 2024)**, matching the #9598 close date.

**Conclusion for Packeta @ 2.17.0: fixed — no workaround needed.** Set the shipping option `price_type: "calculated"`, return `true` from `canCalculate`, implement `calculatePrice`. Model on the official ShipStation guide (calculated price + storefront loading indicator). The M0 skeleton comment ("fixed in 2.15.x") remains accurate at 2.17.0.

> Watch (separate, newer, NOT this bug): Issue **#13062** "Cannot calculate pricing for…" is a runtime
> guard that fires when a provider returns a bad/empty price — an impl/config error, not the #9598 regression.

Sources: https://github.com/medusajs/medusa/discussions/9495 ,
https://github.com/medusajs/medusa/issues/9598 (verified CLOSED/COMPLETED via gh) ,
https://github.com/medusajs/medusa/blob/v2.17.0/packages/core/core-flows/src/cart/workflows/list-shipping-options-for-cart-with-pricing.ts ,
https://docs.medusajs.com/resources/integrations/guides/shipstation

### A3. Storefront → provider data flow (pickup point) — [High] (carried from 2.15 §8, unchanged)

`GET /store/shipping-options` (`sdk.store.fulfillment.listCartOptions`) lists options; the chosen
pickup point is attached through the **`data`** field on
`addShippingMethod(cartId, { option_id, data })` (`POST /store/carts/:id/shipping-methods`) →
validated by `validateFulfillmentData(optionData, data, context)` → persisted on the shipping
method's `data`. At fulfillment time that `data` is what `createFulfillment` receives. The starter's
`setShippingMethod` sends empty `data: {}` and must be extended to carry the point id.
Source: https://docs.medusajs.com/resources/storefront-development/checkout/shipping

---

## PART B — Packeta (Zásilkovna) API surface

Packeta exposes **two** complementary APIs. Operations are split — pricing/labels/shipments live in
SOAP; pickup-point catalog lives in REST; point _selection_ happens client-side via the Widget (Part C).

| Surface            | Style     | Base / endpoint                                                                        | Auth                                                             |
| ------------------ | --------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `packetApi` (SOAP) | SOAP/WSDL | `https://www.zasilkovna.cz/api/soap.wsdl` (PHP-safe variant: `…/soap-php-bugfix.wsdl`) | **API password** (32-char hex), passed as first arg of each call |
| Pickup-point REST  | JSON/XML  | `https://pickup-point.api.packeta.com/v5/<API_KEY>/…`                                  | **API key** in URL path                                          |
| Widget v6          | JS embed  | `https://widget.packeta.com/v6/www/js/library.js`                                      | **API key** (public)                                             |

**API key vs API password (do not confuse):** the **API key** is the public client identifier used in
the REST URL and the widget; the **API password** is the secret 32-char hex used to authenticate SOAP
write calls (`createPacket`, etc.). Both come from the Packeta client portal.
Sources: https://docs.packeta.com/docs/getting-started/packeta-api ,
https://github.com/Zasilkovna/prestashop/blob/v2.1/packetery/packetery.api.php

### B1. SOAP `packetApi` operations — [High] (names verified against the official Zasilkovna PrestaShop plugin)

WSDL: `http://www.zasilkovna.cz/api/soap-php-bugfix.wsdl` (the PHP-bugfix WSDL the official plugin uses;
the canonical WSDL is `…/api/soap.wsdl`). Every call takes `apiPassword` as the first argument.

| Operation                | Purpose                                                                      |
| ------------------------ | ---------------------------------------------------------------------------- |
| `createPacket`           | Create a shipment (packet). Returns packet `id` + `barcode`.                 |
| `createShipment`         | Close/hand over a batch of created packets to Packeta.                       |
| `packetAttributesValid`  | Validate packet attributes **without** creating (use in tests / pre-submit). |
| `packetStatus`           | Current status code/text of a packet (for tracking sync).                    |
| `packetTracking`         | Full tracking history of a packet.                                           |
| `packetLabelPdf`         | Single-packet label PDF (e.g. format `"A7 on A4"`).                          |
| `packetsLabelsPdf`       | Multi-packet labels PDF in one call.                                         |
| `packetCourierNumber`    | Carrier/courier tracking number (for external-carrier packets).              |
| `cancelPacket`           | Cancel a packet.                                                             |
| `senderGetReturnRouting` | Return-routing info for a sender (returns flow).                             |

`createPacket` attribute fields (verified verbatim from `packetery.api.php`):
`number` (your order id), `name`, `surname`, `email`, `phone`, `addressId` (**Packeta pickup-point id**),
`currency`, `cod` (cash-on-delivery amount; `0` if prepaid), `value` (order value, used for insurance),
`weight` (kg), `eshop` (sender label / shop identifier). Address-delivery adds `zip`, `city`, `street`,
`houseNumber`, optional `company`; external carrier pickup adds `carrierPickupPoint`.

**Rate / price calculation — [Medium / important caveat].** Packeta's SOAP/REST API does **not** expose
a real-time "quote this cart" rate endpoint. Shipping prices are governed by your **contractual price
list / carrier configuration** in the Packeta portal, not fetched per-request. So Medusa `calculatePrice`
should compute the rate from **provider `options`** (e.g. a configured base price + per-kg / COD surcharge,
or a price table keyed by destination country/weight), _not_ from a Packeta API call. Treat any assumption
of a live rate API as unverified.
Sources: https://github.com/Zasilkovna/prestashop/blob/v2.1/packetery/packetery.api.php ,
https://docs.packeta.com/docs/getting-started/packeta-api ,
https://github.com/Zasilkovna/WooCommerce (official plugin, same SOAP surface)

### B2. Pickup-point REST (v5) — [High]

Base: `https://pickup-point.api.packeta.com/v5/<API_KEY>/<resource>/<format>` where `<format>` ∈ `json|xml`.

| Endpoint                                              | Purpose                                             |
| ----------------------------------------------------- | --------------------------------------------------- |
| `…/v5/<API_KEY>/point/json`                           | Full export of Packeta's own pickup points.         |
| `…/v5/<API_KEY>/carrier/json`                         | List of external carriers (carrier ids).            |
| `…/v5/<API_KEY>/carrier_point/json?ids[]=<carrierId>` | External carrier pickup points (e.g. `ids[]=3060`). |

Key point fields: `id`, `name`, `city`, `zip`, `latitude`, `longitude`, and **`displayFrontend`** (=1 means
the customer may select it — filter on this). Packeta recommends refreshing the catalog **once daily after
06:00**; do not call per-request. For a Medusa provider you generally do **not** need this REST export at
checkout (the Widget returns the chosen point) — it's useful for server-side validation / batch sync.
Source: https://docs.packeta.com/docs/getting-started/pickup-points (and WebSearch of docs.packeta.com)

---

## PART C — Packeta Widget v6 (storefront pickup-point selector)

### C1. Embedding — [High] (method/URL verified) / [Medium] (exact point-object field list)

Include the library, then call the global:

```html
<script src="https://widget.packeta.com/v6/www/js/library.js"></script>
```

```js
Packeta.Widget.pick(apiKey, callback, opts?, inElement?)
```

(signature verified verbatim from `widget.packeta.com/v6/www/js/library.js`). `apiKey` = the public API
key; `callback(point)` fires on selection (or `null` on close); `opts` configures the widget; optional
`inElement` mounts it inline instead of as a modal. The widget talks to the host via `postMessage`
(`message.packetaPoint`) — relevant if you ever wrap it yourself.

`opts` (configuration) commonly supported: `language` (e.g. `"cs"`/`"en"`), `country` (e.g. `"cz,sk"`),
`vendors` (restrict to Packeta and/or specific external carriers + countries), `defaultCurrency`,
`defaultPrice`, `weight`. **[Medium]** — exact opts keys vary by widget build; confirm against the live
widget doc when wiring.

**Selected `point` object — [Medium]** (commonly documented fields; verify against the live callback in
implementation, the JS-rendered doc could not be quoted this session):
`id` (the value to send to Medusa → becomes Packeta `addressId`), `name`, `place`/`street`, `city`, `zip`,
`country`, `currency`, `carrierId` (set for external-carrier points), `carrierPickupPointId`,
`pickupPointType` (Packeta-internal vs external), `formatedValue` (display label),
`latitude`, `longitude`, `url`.

There is also a server-side validation endpoint `POST https://widget.packeta.com/v6/pps/api/widget/v1/validate`
(JSON body) to re-verify a chosen point id server-side — use it in `validateFulfillmentData` if you want
defense-in-depth rather than trusting the client payload.

### C2. Where this lives in the medusa-cz plugin

Spec §5.2 puts the widget at `src/widgets/pickup-point/` (a client-side React component exported for the
storefront checkout). At minimum the component renders a "Choose pickup point" button → `Packeta.Widget.pick`
→ on callback stores `point.id` (+ display fields) into the shipping-method `data` via
`addShippingMethod(cartId, { option_id, data: { pickup_point_id, pickup_point_name, ... } })`. The provider's
`validateFulfillmentData` then validates/normalizes that `data`, and `createFulfillment` sends
`addressId = pickup_point_id` to SOAP `createPacket`.
Sources: https://docs.packeta.com/docs/pudo-delivery/widget , https://widget.packeta.com/v6/

---

## PART D — Module-provider packaging for 2.17 (fulfillment) — [High]

The comgate **payment** provider proved the build/loadability layout (PR #3, commit `fd723ee`). The same
pattern applies to the fulfillment provider, with one module-type difference. **The repo's
`@medusa-cz/fulfillment-packeta` skeleton already matches it** (`packages/fulfillment-packeta`).

**1. `package.json` exports (identical to comgate — verified in `packages/fulfillment-packeta/package.json`):**

```json
"files": [".medusa/server"],
"exports": {
  "./package.json": "./package.json",
  "./providers/*": "./.medusa/server/src/providers/*/index.js",
  "./*": "./.medusa/server/src/*.js"
},
"scripts": { "build": "medusa plugin:build", "dev": "medusa plugin:develop", "prepublishOnly": "medusa plugin:build" }
```

Deps pinned to **2.17.0** (`@medusajs/*`), `@medusajs/ui` on its own line `4.1.17`, `engines.node >=20`.

**2. Provider entry — `src/providers/packeta/index.ts`** (verified present, correct):

```ts
import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import PacketaProviderService from "./service" // ← see pitfall P1
export default ModuleProvider(Modules.FULFILLMENT, { services: [PacketaProviderService] })
```

**Fulfillment-specific difference:** `Modules.FULFILLMENT` (the payment provider uses `Modules.PAYMENT`).
Everything else — `ModuleProvider(...)` wrapper, `services: [...]`, the `./providers/*` export — is identical.

**3. Registration in `medusa-config.ts`** (nested in the Fulfillment module, requires `id`):

```ts
{ resolve: "@medusajs/medusa/fulfillment",
  options: { providers: [ { resolve: "@medusa-cz/fulfillment-packeta", id: "packeta", options: { /* apiKey, apiPassword, eshop, senderLabel, price table */ } } ] } }
```

Source: https://docs.medusajs.com/resources/commerce-modules/fulfillment/module-options

### D1. PITFALL P1 — `.js` import extensions (the exact thing PR #3 fixed) — [High]

PR #3 made the built comgate plugin loadable by adding `.js` extensions to **relative** imports (Medusa
builds to ESM under `.medusa/server`; extensionless relative imports fail to resolve at runtime). The
comgate entry correctly does `import ComgateProviderService from "../../services/comgate-provider.js"`.

**The current Packeta skeleton does NOT carry the extension** — `providers/packeta/index.ts` has
`import PacketaProviderService from "./service"` (no `.js`). This will hit the same loadability bug PR #3
fixed once there's real build/run. **Fix during M2:** change to `from "./service.js"` (and add `.js` to all
other relative imports — to the future `packeta-client`, types, etc.). Package-name imports
(`@medusajs/framework/utils`) do **not** take an extension.

> Layout note: the skeleton co-locates the service at `providers/packeta/service.ts`; spec §5.2 wrote
> `src/services/packeta-provider.ts` + `src/core/packeta-client.ts`. Both load fine — the only hard
> invariants are the `providers/<name>/index.ts` entry, the `ModuleProvider(Modules.FULFILLMENT, …)` call,
> the `./providers/*` export, and `.js` on relative imports.

---

## PART E — Recommended file structure + implementation notes (TDD with mocked HTTP)

### E1. Suggested structure (extends the existing skeleton; mirrors comgate's proven shape)

```
packages/fulfillment-packeta/
  src/
    providers/packeta/
      index.ts            # ModuleProvider(Modules.FULFILLMENT, { services: [PacketaProviderService] })
      service.ts          # extends AbstractFulfillmentProviderService (import core with .js)
    core/
      packeta-soap-client.ts   # createPacket / cancelPacket / packetStatus / packetLabelPdf (SOAP)
      packeta-rest-client.ts   # pickup-point v5 export + widget validate (optional)
      __tests__/               # vitest unit tests, HTTP mocked
    widgets/pickup-point/      # client React widget (Packeta.Widget.pick), exported for storefront
    types.ts                   # option config, point data, packet attrs
    index.ts                   # plugin barrel
    __tests__/integration/     # @medusajs/test-utils (Jest) — provider loads + flows
  package.json                 # exports ./providers/* (already correct)
```

### E2. Implementation notes / pitfalls

- **P1 — `.js` extensions on relative imports** (Part D1). Single most likely build/load failure; fix first.
- **SOAP from Node/TS:** use a maintained SOAP client (e.g. `soap`). The official WSDL is PHP-flavoured;
  prefer `…/soap-php-bugfix.wsdl` only if the canonical WSDL misbehaves. **Mock the SOAP client in unit
  tests** — wrap it behind `PacketaSoapClient` so tests inject a fake; never hit the network in CI.
- **`calculatePrice` computes from `options`, not from Packeta** (Part B1). There is no live rate API —
  drive pricing from a configured price table (country/weight/COD). This is the cleanest TDD seam: pure
  function, fully unit-testable with no HTTP.
- **`canCalculate` must return `true`** for the calculated option, or Medusa never calls `calculatePrice`
  (the #9598 wiring is what consumes it). Flat-rate options return `false`.
- **Pickup point round-trip:** `point.id` (widget) → shipping-method `data` → `validateFulfillmentData`
  → `createFulfillment` → SOAP `createPacket.addressId`. Store the human-readable point label too for
  admin/order display. Validate the id in `validateFulfillmentData` (optionally via the widget validate
  endpoint) — never trust the raw client payload.
- **Two secrets, two roles:** `apiKey` (REST/widget, public) vs `apiPassword` (SOAP, secret). Keep
  `apiPassword` server-only; the widget only ever needs `apiKey`.
- **Units / COD:** confirm Packeta `value`/`cod` units and currency vs Medusa `BigNumberInput` (major-unit)
  before wiring amounts — mirror the comgate minor/major-unit discipline. **[Medium] — verify in M2.**
- **Labels:** `packetLabelPdf` returns base64/binary PDF; expose via `getShipmentDocuments`/`retrieveDocuments`
  OR a dedicated admin API route. Decide one and keep it; document the choice.
- **Test runners:** Vitest for pure logic (price table, client mappers, data validation); `@medusajs/test-utils`
  (Jest) for "provider loads + `getFulfillmentOptions` resolves" integration. Same split as comgate.

---

## Open items (carry into M2 planning)

- Exact **widget v6 `point` object field names** and `opts` keys — [Medium], JS-rendered docs not quotable
  this session; confirm against the live callback / `docs.packeta.com/docs/pudo-delivery/widget` when wiring C1.
- **Closing PR for #9598** — [Medium]; issue verified CLOSED/COMPLETED (2024-12-24) and fix verified in
  v2.17.0 source, but no single auto-linked PR. Fix outcome is not in doubt.
- **Packeta `value`/`cod`/`weight` units + currency** vs Medusa amounts — [Medium]; verify before money flows.
- **Return flow** (`createReturnFulfillment` + `senderGetReturnRouting`) — likely out of M2 scope; confirm.
- **No live rate API** assumption — [Medium-High]; if a contractual quote endpoint exists for your account,
  re-verify, otherwise price from config.
