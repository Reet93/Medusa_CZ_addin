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

> **Re-verified 2026-06-29 against the live `docs.packeta.com` (Docusaurus, JS-rendered — read this
> session via a headless browser, not memory).** This upgrades the prior pass.

Packeta's **main API** is offered in **two interchangeable transports of the same methods** plus a separate
pickup-point export REST and the client-side Widget. Doc quote (getting-started): _"We provide an API
interface utilizing either a SOAP protocol or a REST interface with XML request bodies. **Both options
function identically.**"_

| Surface                       | Style               | Base / endpoint                                                                                                                                                        | Auth                                                         |
| ----------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Main API — SOAP**           | SOAP/WSDL           | `https://www.zasilkovna.cz/api/soap.wsdl` (PHP 32-bit-safe: `…/soap-php-bugfix.wsdl`; api-reference also uses `https://soap.api.packeta.com/api/soap-php-bugfix.wsdl`) | **API password** (32-char hex), **first arg of every call**  |
| **Main API — REST/XML**       | HTTP POST, XML body | `https://www.zasilkovna.cz/api/rest`                                                                                                                                   | **API password**, as `<apiPassword>` element in the XML body |
| Pickup-point export REST (v5) | JSON/XML            | `https://pickup-point.api.packeta.com/v5/<API_KEY>/…`                                                                                                                  | **API key** in URL path                                      |
| Widget v6                     | JS embed            | `https://widget.packeta.com/v6/www/js/library.js`                                                                                                                      | **API key** (public, `string[16]`)                           |

**REST/XML is NOT a JSON REST API** — it is the _same_ methods as SOAP, sent as an HTTP POST whose XML root
element is the method name and whose children are the args (first = `<apiPassword>`); the response is XML,
root = return-type name. Example:

```xml
<createPacket>
  <apiPassword>__API_PASSWORD__</apiPassword>
  <packetAttributes>
    <number>123456</number><name>John</name><surname>Doe</surname>
    <email>example@packetatest.com</email><phone>+420777123456</phone>
    <addressId>79</addressId><cod>145.55</cod><value>145.55</value>
    <weight>2</weight><eshop>{{SENDER_INDICATION}}</eshop>
  </packetAttributes>
</createPacket>
```

**Recommendation for a Node/Medusa plugin: prefer the REST/XML transport.** It sidesteps the PHP-oriented
WSDL/SoapClient quirks (the docs warn the native PHP `SoapClient` mishandles 64-bit packet ids on 32-bit
systems — hence the bugfix WSDL) and lets you POST a small XML string with `fetch` + a tiny XML
builder/parser (e.g. `fast-xml-parser`), no SOAP stack required. Both transports expose the exact same
method set and fields, so the choice is purely transport ergonomics. (If you prefer SOAP, the `soap` npm
package works against the WSDL.)

**Sandbox / testing — [High], verbatim:** _"Packeta does not have a sandbox environment. You can use your
account for testing purposes as there are no charges unless the packet physically enters our network. You
can create a testing sender so your real packets are not affected by your testing."_ → test against the
**real** endpoint with a dedicated **test sender** (the `eshop` field); never call `createShipment` (the
hand-over) on test packets; `cancelPacket` to clean up. There is **no** test API key/password.

**API key vs API password (do not confuse):** the **API key** (`string[16]`, public) is used in the
pickup-point REST URL and the Widget; the **API password** (32-char hex, secret) authenticates every
main-API call (SOAP or REST/XML). Both come from the Packeta client portal ("Client section").
Sources: https://docs.packeta.com/docs/getting-started/packeta-api ,
https://docs.packeta.com/docs/api-reference/api-methods ,
https://github.com/Zasilkovna/prestashop/blob/v2.1/packetery/packetery.api.php

### B1. Main-API operations — [High] (full method list + prototypes verified verbatim from docs.packeta.com/docs/api-reference/api-methods)

Every call takes `apiPassword` as its (docs-omitted) first argument. Complete method set with exact
prototypes (SOAP types shown; the REST/XML transport uses the identical names/args as XML elements):

| Operation (prototype)                                                             | Purpose                                                                                                         |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `PacketIdDetail createPacket(PacketAttributes attributes)`                        | **Create a packet/shipment.** Returns `PacketIdDetail` (`id` + `barcode`).                                      |
| `void packetAttributesValid(PacketAttributes attributes)`                         | Validate packet attributes **without** creating (pre-submit / tests).                                           |
| `void cancelPacket(unsignedLong packetId)`                                        | **Cancel** a not-yet-physically-submitted packet.                                                               |
| `ShipmentIdDetail createShipment(PacketIds packetIds, string customBarcode)`      | Close / hand a batch of created packets over to Packeta.                                                        |
| `ShipmentPacketsResult shipmentPackets(string shipmentId)`                        | List packets in a shipment.                                                                                     |
| `CurrentStatusRecord packetStatus(unsignedLong packetId)`                         | **Current status** of a packet (tracking sync).                                                                 |
| `StatusRecords packetTracking(unsignedLong packetId)`                             | **Full tracking history** of a packet.                                                                          |
| `PacketInfoResult packetInfo(unsignedLong packetId)`                              | Packet detail info.                                                                                             |
| `binary packetLabelPdf(unsignedLong packetId, string format, unsignedInt offset)` | **Single-packet label PDF** (`format` e.g. `A6 on A4`, `A7 on A4`, `A7 on A6`; `offset` skips label positions). |
| `binary packetsLabelsPdf(PacketIds packetIds, string format, unsignedInt offset)` | Multi-packet labels PDF in one call.                                                                            |
| `binary packetLabelZpl(unsignedLong packetId, unsignedInt dpi)`                   | Label as ZPL (thermal printers).                                                                                |
| `string packetCourierNumber(unsignedLong packetId)`                               | Carrier/courier tracking number (external-carrier packets).                                                     |
| `string packetCourierNumberV2(unsignedLong packetId)`                             | V2 (`PacketCourierNumberV2Result`).                                                                             |
| `ExternalStatusRecords packetCourierTracking(unsignedLong packetId)`              | External-carrier tracking events.                                                                               |
| `binary packetCourierLabelPdf(unsignedLong packetId, string courierNumber)`       | External-carrier label PDF (PNG/ZPL variants exist).                                                            |
| `binary barcodePng(string barcode)`                                               | Code-128 PNG (`packetId` prefixed with `Z`, e.g. `Z1234567890`).                                                |
| `PacketDetail createPacketClaimWithPassword(ClaimWithPasswordAttributes a)`       | Create a claim/return packet (supersedes deprecated `createPacketClaim`).                                       |
| `CreatePacketsB2BResults createPacketsB2B(PacketB2BAttributes attributes)`        | Create B2B packets.                                                                                             |
| `string[] senderGetReturnRouting(string senderLabel)`                             | Return-routing info for a sender (returns flow).                                                                |
| `NullableDate packetGetStoredUntil(...)` / `void packetSetStoredUntil(...)`       | Read/set the pickup-point storage deadline.                                                                     |

WSDL host note: getting-started cites `https://www.zasilkovna.cz/api/soap.wsdl` (PHP 32-bit-safe variant
`…/soap-php-bugfix.wsdl`); the api-reference examples use `https://soap.api.packeta.com/api/soap-php-bugfix.wsdl`.
`createPacket` returns **`PacketIdDetail`** = new packet `id` (`unsignedLong` — **treat as string** to
avoid 64-bit truncation) + `barcode`. Errors: `PacketAttributesFault` (per-field), `IncorrectApiPasswordFault`;
cancel errors: `PacketIdFault`, `CancelNotAllowedFault`.

**`PacketAttributes` fields — verbatim from docs.packeta.com/docs/api-reference/data-structures** (Required/constraints as documented):

| Type          | Field                               | Required                  | Notes                                                                             |
| ------------- | ----------------------------------- | ------------------------- | --------------------------------------------------------------------------------- |
| `string`      | `number`                            | **yes**                   | Unique e-shop order id (1–36 alnum).                                              |
| `string`      | `name` / `surname`                  | **yes**                   | Recipient (1–32, restricted charset).                                             |
| `string`      | `company`                           | no                        | 1–32 alnum.                                                                       |
| `string`      | `email`                             | if no `phone`             | Valid email.                                                                      |
| `string`      | `phone`                             | if no `email`             | Valid phone (see phone-number-formats page).                                      |
| `unsignedInt` | `addressId`                         | **yes**                   | **Pickup-point branch ID, or external-carrier ID** — the widget's `point.id`.     |
| `string`      | `currency`                          | no                        | `CZK,EUR,HUF,PLN,RON`.                                                            |
| `decimal`     | `cod`                               | no                        | COD; whole number for CZK, multiple of 5 for HUF; `0`/omit if prepaid.            |
| `decimal`     | `value`                             | **yes**                   | Packet value (insurance); max per TOS.                                            |
| `decimal`     | `weight`                            | **yes**                   | kg.                                                                               |
| `string`      | `eshop`                             | when >1 sender            | **Sender indication** — unknown value creates a new sender (use for test sender). |
| `date`        | `deliverOn`                         | no                        | Scheduled delivery `YYYY-MM-DD`, within 14 days.                                  |
| `boolean`     | `adultContent`                      | no                        | 18+ handover (CZ/SK/HU/RO internal points only).                                  |
| `string`      | `note`                              | no                        | 1–128; shown on label if courier supports.                                        |
| `string`      | `street`/`houseNumber`/`city`/`zip` | **on home delivery**      | Address-delivery (`province` optional).                                           |
| `string`      | `carrierService`                    | no                        | Comma-separated carrier services.                                                 |
| `string`      | `carrierPickupPoint`                | **yes for some carriers** | External carrier's pickup-point code.                                             |

> **Internal pickup point vs external carrier:** for a **Packeta internal** point set `addressId = point.id`.
> For an **external-carrier** point the widget returns `carrierId` + `carrierPickupPointId`; set
> `addressId = carrierId` and `carrierPickupPoint = carrierPickupPointId`.

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

### C1. Embedding — [High] (method, opts, AND point object now verified verbatim from docs.packeta.com/docs/pudo-delivery/widget)

> Upgraded from [Medium] → [High]: the JS-rendered widget doc was read this session. The library is now
> the documented integration library, not the bare iframe bundle.

Include the integration library, then call the global:

```html
<script src="https://widget.packeta.com/v6/www/js/library.js"></script>
```

```js
Packeta.Widget.pick(apiKey, callback, options?, inElement?)
Packeta.Widget.close()   // closes any open widget
```

**Arguments (verbatim from docs):**

- `apiKey` `string[16]` **required** — "An identifier of your Packeta account" (the public **API key**, NOT the SOAP API password).
- `callback` `function` **required** — "called when the user confirms or cancels PUDO point selection. The function will receive one argument, that will be either a `Point` object if PUDO point was selected, or `null` if selection was cancelled." (Doc note: "To get selected PUDO point's vendor code, call the validation endpoint.")
- `options` — a JSON-file URL or an `Options` object (see below).
- `inElement` — optional DOM element to render the widget inline (modal otherwise). The app lives in an isolated iframe and communicates via `window.postMessage()`. Recommended iframe perms: `sandbox="allow-scripts allow-same-origin" allow="geolocation"`.

**`Options` (configuration) — documented keys:** `webUrl`, `appIdentity` (e.g. `"prestashop-1.6-packeta-4.1"`),
`vendors` (Array of `Vendor` — **recommended**; restricts which carriers/points show), `country`
(comma-separated ISO-3166-1 alpha-2 lowercase, e.g. `"cz,sk"`), `language` (`string[2]`, e.g. `cs`,`en`,`sk`,`de`…),
`claimAssistant`, `packetConsignment`, `weight` (kg), `length`/`width`/`depth` (cm), `longitude`/`latitude`,
`livePickupPoint` (18+), `expeditionDay` (`YYYY-MM-DD`), `defaultPrice`, `defaultCurrency`, `centerExternalId`.
`Vendor` = `{ carrierId? , country? , group? ("zbox" | "" for zpoint), selected?, price?, currency? }`.

**Selected `Point` object — [High], verbatim field list from the doc** (key fields for Medusa):

| Field                                                                                       | Meaning                                                                                                                                               |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                                                        | **Internal pickup-point Branch ID** → send to Medusa → becomes Packeta `addressId`. (External points use `carrierId`+`carrierPickupPointId` instead.) |
| `name`                                                                                      | City + street (large cities incl. district).                                                                                                          |
| `place`,`street`,`city`,`zip`,`country`,`currency`                                          | Address parts; `country` ISO alpha-2 lowercase; `currency` ISO-4217.                                                                                  |
| `gps`                                                                                       | `{ lat, lon }`.                                                                                                                                       |
| `pickupPointType`                                                                           | `"internal"` (Packeta) or `"external"` (carrier).                                                                                                     |
| `carrierId`                                                                                 | external points only — external carrier ID.                                                                                                           |
| `carrierPickupPointId`                                                                      | external points only — external carrier's point code.                                                                                                 |
| `group`                                                                                     | internal points — `"zbox"` or empty (`zpoint`).                                                                                                       |
| `externalId`                                                                                | Unique identifier.                                                                                                                                    |
| `branchCode`,`routingCode`                                                                  | URL-safe id / routing code (custom labels).                                                                                                           |
| `packetConsignment`,`claimAssistant`,`maxWeight`,`creditCardPayment`,`wheelchairAccessible` | capability flags.                                                                                                                                     |
| `openingHours`,`directions*`,`photo`,`error`/`warning`/`recommended`/`isNew`                | display/availability metadata.                                                                                                                        |
| `formatedValue`,`nameStreet`,`url`,`photos`                                                 | **deprecated** aliases (`name`/`branchCode`/`photo` replace them).                                                                                    |

**Server-side validation endpoint (recommended for `validateFulfillmentData`):**
`POST https://widget.packeta.com/v6/pps/api/widget/v1/validate`, JSON body
`{ apiKey, point: { id } | { carrierId, carrierPickupPointId }, options: { country, vendors, weight, … } }`
(same options the widget was initialized with). Responses: `200` (inspect `isValid` + `errors[]`),
`400` (bad params), `401` (invalid API key). On success returns `{ isValid, point: { name, address:{street,city,zip,country}, group|carrierId }, errors[] }`.
Error codes incl. `NotFound`, `InvalidCountry`, `InvalidCarrier`, `InvalidWeight`, `PickupPointVacation`,
`PickupPointIsFull`, `PickupPointForbidden`, `NoCashOnDelivery`, `InvalidDimensions`. The doc explicitly
warns selection happens on the user's device and "technically skilled user is able to bypass our
validation" — so validate server-side, do not trust the raw client payload.

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

- ~~Exact widget v6 `point` object field names and `opts` keys~~ — **RESOLVED 2026-06-29 → [High]** (C1):
  JS-rendered widget doc read this session; full `Point`/`Options` field lists + validate endpoint now verbatim.
- **Closing PR for #9598** — [Medium]; issue verified CLOSED/COMPLETED (2024-12-24, closed by maintainer
  `shahednasser`: "this issue is fixed in the latest release"; commenters point at ~v2.1.3) and the
  `calculatePrice` wiring verified present in v2.17.0 source. Exact patch version is [Medium]; fix outcome is not in doubt.
- **Packeta `value`/`cod`/`weight` units + currency** vs Medusa amounts — [Medium]; verify before money flows.
  (Docs constraints confirmed: `cod` whole-number for CZK, multiple of 5 for HUF; `currency` ∈ CZK/EUR/HUF/PLN/RON.)
- **Return flow** (`createReturnFulfillment` + `createPacketClaimWithPassword`/`senderGetReturnRouting`) — likely out of M2 scope; confirm.
- **No live rate API** assumption — **confirmed [High]**: Packeta exposes no per-request rate/quote endpoint;
  prices come from the contractual price list. `calculatePrice` must compute from provider `options` (config price table).
- **Testing** — confirmed [High]: no sandbox; test on the real endpoint with a dedicated test `eshop` sender,
  never call `createShipment` on test packets (no charge until handed over); `cancelPacket` to clean up.
