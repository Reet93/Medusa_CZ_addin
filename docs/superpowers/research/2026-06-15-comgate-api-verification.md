# M1 docs-gate — Comgate API + Medusa 2.15 payment internals (verified)

> Vendor docs-gate for the M1 spec (§8). Verified 2026-06-15 against live sources (not memory).
> Confidence per `local.md` §2. If implementation conflicts with this doc, re-verify against the cited source.

---

## PART A — Comgate REST API (verified against https://apidoc.comgate.cz/)

### A1. Protocol — [High]

Two supported APIs (+ deprecated SOAP). **Target REST v2.0.**

| API                       | Style                    | Base (LIVE)                         | Auth                                 |
| ------------------------- | ------------------------ | ----------------------------------- | ------------------------------------ |
| REST v2.0 (chosen)        | JSON                     | `https://payments.comgate.cz/v2.0/` | HTTP Basic `base64(merchant:secret)` |
| HTTP POST v1.0 (fallback) | form-encoded `key=value` | `https://payments.comgate.cz/v1.0/` | `merchant`+`secret` in body          |

**No separate sandbox host.** Test mode = `"test": true` flag on the same base URL. Source: `/en/specifikace-protokolu/`, `/en/api/rest/`, `/en/faq/`.

### A2. Create payment — [High]

`POST https://payments.comgate.cz/v2.0/payment.json` (JSON, Basic auth).

Params: `price` (**integer, MINOR units / cents-haléře** — `1000` = 10.00 CZK; HUF ends in `00`), `curr` (CZK/EUR/USD/GBP/PLN/HUF/RON/NOK/SEK), `label` (1–16 chars), `refId` (order ref), `method` (`"ALL"` to let payer choose), `email` or `phone` (one required), `prepareOnly: true` (background create → returns `redirect` URL), `preauth: true` (pre-auth → status `AUTHORIZED`), `test`, `country` (default CZ), `lang`, and per-request return overrides `url_paid`/`url_cancelled`/`url_pending` (template vars `${id}`, `${refId}`).

Response: `code` (0=OK), `message`, `transId`, `redirect` (**use verbatim**). Source: `/en/api/rest/`, `/en/api/post/`.

### A3. Status — [High]

`GET https://payments.comgate.cz/v2.0/payment/transId/{transId}.json` (Basic auth).
Response incl. `status`, `price`, `curr`, `refId`, `fee`, `paymentErrorReason`, etc.
**Status values:** `PENDING` (non-terminal), `PAID` (terminal, goods can ship), `AUTHORIZED` (pre-auth held; needs capture), `CANCELLED` (terminal). Source: `/en/stavy-plateb/`.

### A4. Refund — [High]

`POST https://payments.comgate.cz/v2.0/refund.json`. Params: `transId`, `amount` (**minor units**, full or partial), `curr`, `refId?`, `test?`. Errors: **1401** payment is CANCELLED, **1402** amount higher than allowed. Source: `/en/api/rest/`.

### A5. Pre-authorization — [High]

Create with `preauth: true` → on approval status = `AUTHORIZED`.

- Capture: `PUT https://payments.comgate.cz/v2.0/preauth/transId/{transId}.json` (optional `amount` for partial capture). v1.0: `POST /v1.0/capturePreauth`.
- Cancel: `DELETE https://payments.comgate.cz/v2.0/preauth/transId/{transId}.json`. v1.0: `POST /v1.0/cancelPreauth`.
- **Constraint:** both only valid on `AUTHORIZED` status. Source: `/en/api/rest/`, help.comgate.cz/docs/en/preauthorization.

### A6. Callback / webhook — [High]

Comgate `POST`s to the merchant notification URL on every status change. Content type form-encoded (POST API) / JSON (REST). Payload fields: `transId`, `merchant`, `status` (`PAID`/`CANCELLED`/`AUTHORIZED`), `price`, `curr`, `label`, `refId`, `test`, `secret`, `email`, … **No HMAC/signature.** Security model: **never trust the notification alone — always re-query `status` by `transId`.** Configure URL in the Client Portal (per-request `url_*` overrides also exist). Must return HTTP 2xx or Comgate retries (up to 1000×). Source: `/en/push-notifikace/`.

### A7. Test mode — [High mechanism / Low test-cards]

`test: true` on create; same base URL. Credentials = normal portal `merchant`+`secret`; test payments visible to a portal user with the **Tester** role. Drive `PENDING → PAID/CANCELLED` via a **button in the portal test-payment detail** (no documented gateway test-card PAN list — treat as unverified). Source: `/en/faq/`, `/en/stavy-plateb/`.

### A8. Error model — [High]

Integer `code` (0=OK) + `message`. Notable: 1301 unknown merchant, 1308 method not allowed, 1309 wrong amount, 1310 unknown currency, 1400 bad request / unauthorized IP (whitelist server IP in portal), 1401 refund on CANCELLED, 1402 refund too high. Source: `/en/api/post/`, `/en/api/rest/`.

---

## PART B — Medusa 2.15 payment internals (verified against medusajs/medusa v2.15.0; provider types re-checked v2.15.5 — identical)

### B1. The 10 method types — [High]

Base: every input extends `PaymentProviderInput { data?: Record<string,unknown>; context?: PaymentProviderContext }`; every output extends `PaymentProviderOutput { data?: Record<string,unknown> }`. `context` has `customer?`, `account_holder?`, `idempotency_key?`.

| Method                    | Input adds                                        | Output adds                                   |
| ------------------------- | ------------------------------------------------- | --------------------------------------------- |
| `initiatePayment`         | `amount: BigNumberInput`, `currency_code: string` | `id: string`, `status?: PaymentSessionStatus` |
| `authorizePayment`        | —                                                 | `status: PaymentSessionStatus`                |
| `capturePayment`          | —                                                 | — (data only)                                 |
| `refundPayment`           | `amount: BigNumberInput`                          | —                                             |
| `cancelPayment`           | —                                                 | —                                             |
| `deletePayment`           | —                                                 | —                                             |
| `getPaymentStatus`        | —                                                 | `status: PaymentSessionStatus`                |
| `retrievePayment`         | —                                                 | —                                             |
| `updatePayment`           | `amount: BigNumberInput`, `currency_code: string` | `status?: PaymentSessionStatus`               |
| `getWebhookActionAndData` | `ProviderWebhookPayload["payload"]`               | `WebhookActionResult`                         |

- **`amount` is `BigNumberInput`** (`number | string | BigNumber | BigNumberRawValue`) — normalize before use. `currency_code` is a lowercase string (e.g. `"czk"`).
- Stored session `data` round-trips into the base `data` on every later call — persist the Comgate `transId` there from `initiatePayment`.
- Source: `packages/core/types/src/payment/provider.ts`.

### B2. `PaymentSessionStatus` — [High]

`authorized` | `captured` | `pending` | `requires_more` | `error` | `canceled`. Source: `packages/core/utils/src/payment/payment-session.ts`.

### B3. `getWebhookActionAndData` — [High]

Input `ProviderWebhookPayload["payload"]` = `{ data: Record<string,unknown>; rawData: string|Buffer; headers: Record<string,unknown> }`.
Return `WebhookActionResult` = `{ action: PaymentActions; data?: { session_id: string; amount: BigNumberValue } }`.
**`PaymentActions`** (note key/value mismatch): `AUTHORIZED="authorized"`, `SUCCESSFUL="captured"`, `FAILED="failed"`, `PENDING="pending"`, `REQUIRES_MORE="requires_more"`, `CANCELED="canceled"`, `NOT_SUPPORTED="not_supported"`. Source: `packages/core/utils/src/payment/webhook.ts`, `packages/core/types/src/payment/mutations.ts`.

### B4. Webhook route — [High]

`POST /hooks/payment/[provider]` where `[provider]` is the **composed id** `pp_{identifier}_{id}`. Route emits an event (default ~5s delay, 3 retries — [Medium] on exact defaults) → subscriber → payment module `processEvent` → your `getWebhookActionAndData`. Source: `packages/medusa/src/api/hooks/payment/[provider]/route.ts`.

### B5. Registration — [High]

```ts
{ resolve: "@medusajs/medusa/payment", options: { providers: [
  { resolve: "@medusa-cz/payment-comgate", id: "comgate", options: { merchant, secret, test, capture, method } }
] } }
```

Composed id = `pp_${identifier}${id ? "_"+id : ""}` → with `identifier="comgate"`, `id="comgate"` → **`pp_comgate_comgate`** (used in webhook URL + stored `provider_id`). Source: `packages/modules/payment/src/loaders/providers.ts`.

### B6. Authorize vs capture + auto-capture — [High]

Cart completion → `authorizePaymentSessionStep` → module `authorizePaymentSession` → your `authorizePayment`. **Auto-capture rule:** if `authorizePayment` returns `PaymentSessionStatus.CAPTURED`, the module flips it to `AUTHORIZED` and **auto-calls `capturePayment`**. So:

- **Auto mode:** when Comgate `PAID` at completion → return `CAPTURED` → Medusa auto-captures. If still `PENDING` → return `PENDING`/`REQUIRES_MORE`; the webhook finalizes.
- **Manual mode:** when Comgate `AUTHORIZED` → return `AUTHORIZED`; capture later via `capturePayment` → `capturePreauth`.
  Source: `packages/modules/payment/src/services/payment-module.ts`, complete-cart core-flow.

---

## Mapping summary (drives the provider) — [High] contract / [Medium] glue

| Medusa method                      | Comgate call                                                    | Returns                                            |
| ---------------------------------- | --------------------------------------------------------------- | -------------------------------------------------- |
| initiatePayment                    | `POST /v2.0/payment.json` (prepareOnly, preauth=manual)         | `{ id: transId, data: { transId, redirect_url } }` |
| getPaymentStatus / retrievePayment | `GET /v2.0/payment/transId/{id}.json`                           | map status                                         |
| authorizePayment                   | status → CAPTURED(auto)/AUTHORIZED(manual)/PENDING              | `{ status, data }`                                 |
| capturePayment                     | auto: no-op; manual: `PUT /v2.0/preauth/transId/{id}.json`      | `{ data }`                                         |
| refundPayment                      | `POST /v2.0/refund.json` (amount minor units)                   | `{ data }`                                         |
| cancelPayment / deletePayment      | manual+AUTHORIZED: `DELETE /v2.0/preauth/...`; else best-effort | `{ data }`                                         |
| updatePayment                      | amount changed pre-redirect → re-create; else no-op             | `{ status?, data }`                                |
| getWebhookActionAndData            | re-query status by transId, map to PaymentActions               | `{ action, data: { session_id, amount } }`         |

**Amount conversion:** Medusa `BigNumberInput` (major unit, e.g. 10.00 CZK) → Comgate minor units (`Math.round(amount * 100)`). Reverse on the way back. Confirm decimal handling for zero-decimal currencies (HUF).

## Open items (carry into planning)

- Comgate gateway test-card list — unverified; use the portal Tester-role button to drive test payments. [Low]
- Exact `webhook_delay`/`webhook_retries` option keys if we override Medusa's defaults. [Medium]
- `session_id` for `WebhookActionData`: Comgate echoes our `refId`/`transId`, not Medusa's payment session id directly — confirm how to resolve session id in the webhook (likely store the mapping, or set refId = session id). [Medium — resolve in Task]
