# M1 — Comgate payment provider (`@medusa-cz/payment-comgate`)

> Design spec. Brainstormed 2026-06-15. Status: approved, pre-plan.
> Grounds: `docs/superpowers/specs/2026-06-13-medusa-cz-architecture-design.md` (§5.1, §7, §9),
> `docs/superpowers/research/2026-06-14-medusa-2.15-verification.md` (§3 `AbstractPaymentProvider`).
> Confidence tags per `local.md` §2: **[High]** verified · **[Medium]** reasoned/unverified · **[Low]** guess.

## Goal

Turn the M0 `payment-comgate` skeleton into a working Comgate payment provider for MedusaJS
2.15, proven **end-to-end in the demo** via a real Comgate-sandbox checkout round-trip. This is
the milestone that proves the payment-provider archetype (spec §9, M1).

## Approach (chosen)

**A — Own thin REST client + provider service.** A self-contained Comgate REST client lives in the
package; the provider service maps Medusa's 10 abstract methods onto it. Rejected: (B) wrapping a
community Comgate SDK — adds an uncontrolled dependency, spotty on the JSON API / pre-auth, weakens
the clean-provider story; (C) extracting a generic redirect-payment base into `@medusa-cz/shared`
now — premature (one data point); revisit when GoPay (M3) arrives (rule of three).

## Decisions (this session)

| #    | Decision                                                                                                   | Confidence | Notes                                                                                                                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1-1 | **Capture model = both, configurable** via option `capture: "automatic" \| "manual"` (default `automatic`) | [High]     | User chose flexibility over YAGNI (Claude flagged the cost). Design keeps the `prepareOnly`/`preauth` flag + capture path clean to toggle.                                                                       |
| M1-2 | **Test strategy = hybrid**                                                                                 | [High]     | Mocked-HTTP TDD = blocking CI gate (hermetic, no secrets). Opt-in sandbox integration suite, auto-skipped without `COMGATE_*` env; runs local/nightly, never blocks PR CI.                                       |
| M1-3 | **Demo scope = full storefront round-trip**                                                                | [High]     | Real redirect → pay (sandbox) → return → confirm is the M1 acceptance. Cannot be the CI gate (needs creds + Postgres + publishable key + manual run). Provider itself stays hermetically proven by mocked tests. |
| M1-4 | `method: "ALL"` (Comgate-hosted method picker), configurable default                                       | [Medium]   | Broadest CZ coverage (cards + bank buttons + Apple/Google Pay); single "Pay with Comgate" redirect in the storefront.                                                                                            |
| M1-5 | Currency = pass-through from the cart (default CZK)                                                        | [Medium]   | Medusa supplies amount + currency_code; client forwards `curr`.                                                                                                                                                  |

## 1. Package structure — [High]

```
packages/payment-comgate/src/
├── services/comgate-provider.ts   # extends AbstractPaymentProvider; maps 10 methods → client
├── core/comgate-client.ts         # thin REST client: create, status, refund, capturePreauth, cancelPreauth
├── types.ts                       # options, Comgate request/response shapes, status enums
├── index.ts                       # ModuleProvider export (present from M0)
└── __tests__/
    ├── comgate-provider.test.ts   # unit, mocked client — part of the CI gate
    ├── comgate-client.test.ts     # unit, mocked fetch
    └── integration/               # opt-in sandbox suite, skipped unless COMGATE_* env present
```

The HTTP client stays in-package (spec §8). `@medusa-cz/shared` is not touched in M1.

## 2. The 10-method → Comgate mapping — [High] (Medusa contract) / [Medium] (Comgate calls)

- **initiatePayment** → `create` (`prepareOnly=true`, `preauth = capture === "manual"`, `price`/amount, `curr`, `label`, `refId`, `method`, `email`). Returns `{ id: transId, data: { transId, redirect_url, … } }`. Session status implicitly `pending`.
- **getPaymentStatus / retrievePayment** → `status` → map Comgate → Medusa status.
- **authorizePayment** → read status: `PAID` → `captured` (auto) or `authorized` (manual); `PENDING` → `pending`/`requires_more`; `CANCELLED` → `canceled`.
- **capturePayment** → auto: confirm/no-op (Comgate already captured); manual: `capturePreauth`.
- **refundPayment** → `refund` (amount; supports partial).
- **cancelPayment / deletePayment** → manual/unpaid: `cancelPreauth` / best-effort; return data.
- **updatePayment** → amount changed pre-redirect → re-`create`; otherwise no-op (Comgate tx amount is immutable post-create).
- **getWebhookActionAndData** → parse Comgate callback → `{ action, data: { session_id, amount } }`.

**Status map:** `PENDING → pending`, `PAID → captured | authorized` (per capture mode), `CANCELLED → canceled`, unknown/error → `error`. Exact Medusa enum values (`PaymentSessionStatus`, `PaymentActions`, `WebhookActionResult`) confirmed in the docs-gate (§8).

## 3. Payment + confirmation flow — [Medium]

1. Checkout → `initiatePayment` creates the Comgate transaction; `redirect_url` stored on the payment session.
2. Storefront redirects the customer to Comgate; customer pays.
3. **Two confirmation paths:**
   - **(a) Return page** — Comgate redirects the customer back to our `returnURL`; the page calls `getPaymentStatus` → authorize/capture → completes the cart. Works locally with no public tunnel.
   - **(b) Webhook** — `POST /hooks/payment/comgate` → `getWebhookActionAndData`. Production-grade async source of truth; reconciles lost/over-taken return navigations.
4. Refund / cancel are driven from admin via `refundPayment` / `cancelPayment`.

## 4. Config / `validateOptions` — [High]

Options: `merchant` (id), `secret`, `test` (bool), `capture: "automatic" | "manual"` (default `automatic`),
`method` (default `"ALL"`), optional `country`. `validateOptions` throws if `merchant` or `secret`
is missing. Currency is not configured — it passes through from the cart.

## 5. Storefront demo wiring (the round-trip) — [Medium]

- `apps/backend/medusa-config.ts`: register `@medusa-cz/payment-comgate` (id `comgate`) with sandbox
  options from env; seed/enable a CZK region with the provider.
- `apps/storefront`: add a Comgate branch to the checkout payment step — on submit, ensure the payment
  session, read `redirect_url`, `window.location` to Comgate; add a **return route** that confirms via
  status and completes the cart. Modeled on the starter's existing `payment-container` /
  `payment-button` patterns. Exact starter hooks verified during planning.

## 6. Error handling — [Medium]

`comgate-client` normalizes non-OK HTTP responses and Comgate error codes into a typed `ComgateError`;
the provider surfaces Medusa-friendly errors. Network/5xx are tagged retryable. `getPaymentStatus` is
the reconciliation path when a webhook is lost. HTTP-error normalization may later move to
`@medusa-cz/shared` — not in M1.

## 7. Testing & acceptance — [High]

- **TDD, RED → GREEN → REFACTOR.** Unit tests (mocked HTTP) cover the client and all provider
  methods across both capture modes. This is the **blocking CI gate** and needs no secrets.
- **Opt-in sandbox suite** (`__tests__/integration/`) hits the Comgate sandbox; auto-skipped unless
  `COMGATE_MERCHANT` / `COMGATE_SECRET` are present. Runs locally / nightly; never blocks PR CI.
- **Manual acceptance** (documented in the package README): run Postgres + backend + storefront →
  checkout → sandbox pay → return → order placed. Exercise both `automatic` and `manual` capture,
  plus a refund from admin.

## 8. Vendor docs-gate (run FIRST in planning — verify, don't trust memory)

Per `local.md` §1 (verify against current docs). Confirm before any client code:

1. Comgate API protocol in use (v1.0 form-encoded vs JSON API) and base URLs (live + sandbox).
2. `create` / `status` / `refund` / `capturePreauth` / `cancelPreauth` — exact endpoints, params, auth, and response shapes.
3. Comgate callback (webhook) payload fields and signature/verification, if any.
4. Sandbox/test-mode specifics and test card/credentials.
5. Medusa 2.15 exact payment webhook route + `WebhookActionResult` / `PaymentActions` enum values.
6. How the official Next.js starter's checkout payment step dispatches a redirect-style provider.

## 9. Out of scope (YAGNI) — [High]

Recurring / subscriptions, saved cards / tokenization, partial-capture orchestration beyond what
Medusa drives, Apple/Google-Pay-specific tuning, multi-tenant credentials. Extracting a shared
redirect-payment base waits for GoPay (M3).

## Acceptance summary

- All provider unit tests green (mocked, both capture modes) — blocking CI gate.
- Opt-in sandbox suite passes when creds are supplied.
- Demo: a real Comgate-sandbox checkout round-trip completes an order in the storefront; a refund
  succeeds from admin.
- No business logic leaks outside the package; `@medusa-cz/shared` unchanged.
