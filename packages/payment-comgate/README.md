# @medusa-cz/payment-comgate

Comgate payment provider for MedusaJS 2.17 (Czech market). Redirect flow; automatic or
pre-auth (manual) capture.

## Install

```bash
pnpm add @medusa-cz/payment-comgate
```

## Register (`medusa-config.ts`)

```ts
{
  resolve: "@medusajs/medusa/payment",
  options: { providers: [
    { resolve: "@medusa-cz/payment-comgate/providers/comgate", id: "comgate",
      options: { merchant: process.env.COMGATE_MERCHANT, secret: process.env.COMGATE_SECRET,
                 test: true, capture: "automatic" } },
  ] },
}
```

The resolve path must be the `/providers/comgate` subpath, not the bare package name —
this package's `exports` map (like `fulfillment-packeta`'s) only exposes `./providers/*`.
Already registered this way in `apps/backend/medusa-config.ts` for the demo.

Provider id becomes `pp_comgate_comgate`. Webhook URL: `https://<host>/hooks/payment/pp_comgate_comgate`
(configure in the Comgate Client Portal). Comgate webhooks are unsigned — the provider always
re-queries status.

## Options

| Option   | Required | Default   | Notes                              |
| -------- | -------- | --------- | ---------------------------------- |
| merchant | yes      | —         | Comgate merchant id                |
| secret   | yes      | —         | Comgate API secret                 |
| test     | no       | true      | sandbox/test mode                  |
| capture  | no       | automatic | `automatic` \| `manual` (pre-auth) |
| method   | no       | ALL       | Comgate method id                  |
| country  | no       | CZ        | restricts methods                  |

## Capture modes

- **automatic** (default): Comgate captures on `PAID`. `authorizePayment` returns `captured`, so
  Medusa skips a separate capture call.
- **manual** (pre-auth): `authorizePayment` returns `authorized`; `capturePayment` then calls
  Comgate's preauth-capture (optional partial amount). `cancelPayment`/`deletePayment` release the
  preauth.

## Tests

```bash
pnpm --filter @medusa-cz/payment-comgate test               # unit (mocked) — the CI gate
pnpm --filter @medusa-cz/payment-comgate test:integration   # opt-in sandbox; skips without creds
```

The integration suite runs only when `COMGATE_MERCHANT` and `COMGATE_SECRET` are set; it creates a
test (`test: true`) payment and reads its status against the live sandbox.

## Manual acceptance (sandbox round-trip)

1. `export COMGATE_MERCHANT=… COMGATE_SECRET=…` (Tester role in the portal), and set the
   same vars in `apps/backend/.env` — `COMGATE_MERCHANT`, `COMGATE_SECRET`, optionally
   `COMGATE_TEST` (default `true`) and `COMGATE_CAPTURE` (default `automatic`); this is
   what `apps/backend/medusa-config.ts`'s registration reads.
2. Start Postgres; `cd apps/backend && pnpm dev`; run the seeds, in order:
   `npx medusa exec ./src/scripts/seed-packeta.ts` (creates the Czechia/CZK region — must
   run first) then `npx medusa exec ./src/scripts/seed-comgate.ts` (enables Comgate on it;
   idempotent, safe to re-run).
3. Create a publishable key + set it in `apps/storefront/.env.local`; `cd apps/storefront && pnpm dev`.
4. Add a product to the CZK region cart → checkout → "Pay with Comgate" → redirected to Comgate.
5. In the portal test-payment detail, mark the payment PAID → returned to `/comgate/return` → order placed.
6. Repeat with `capture=manual` (status AUTHORIZED → capture from admin) and run a refund from admin.
