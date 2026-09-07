# @medusa-cz/invoicing-abraflexi

Abra Flexi invoicing for MedusaJS 2.0 (medusa-cz). Listens for `payment.captured`,
issues a Czech sales invoice in Abra Flexi, then marks it paid — both via durable,
retried Medusa workflows. Idempotent — a second capture on an already-invoiced
order creates no duplicate invoice, and a second capture with a _different_
payment id (Medusa's split-tender case) records that payment too, without
re-recording ones already seen.

## Install

```bash
pnpm add @medusa-cz/invoicing-abraflexi
```

## Register (`medusa-config.ts`)

Register this package under `plugins:`, not `modules:` — Medusa's plugin loader
builds its subscriber/workflow list exclusively from `configModule.plugins`, so a
`modules:`-only registration silently never fires `payment.captured`. A plugin
entry auto-registers its `modules/*` with the same options, so there's no need
for a separate `modules:` entry alongside it.

```ts
plugins: [
  {
    resolve: "@medusa-cz/invoicing-abraflexi",
    options: {
      baseUrl: process.env.ABRA_FLEXI_BASE_URL,
      company: process.env.ABRA_FLEXI_COMPANY,
      username: process.env.ABRA_FLEXI_USERNAME,
      password: process.env.ABRA_FLEXI_PASSWORD,
      vatPayer: process.env.ABRA_FLEXI_VAT_PAYER === "true",
    },
  },
]
```

## Options

| Option     | Env var                | Required | Default | Notes                                                          |
| ---------- | ---------------------- | -------- | ------- | -------------------------------------------------------------- |
| `baseUrl`  | `ABRA_FLEXI_BASE_URL`  | yes      | —       | Cloud (`https://<company>.flexibee.eu`) or self-hosted server. |
| `company`  | `ABRA_FLEXI_COMPANY`   | yes      | —       | Company/evidence slug in the API URL path.                     |
| `username` | `ABRA_FLEXI_USERNAME`  | yes      | —       | HTTP Basic auth.                                               |
| `password` | `ABRA_FLEXI_PASSWORD`  | yes      | —       | HTTP Basic auth.                                               |
| `vatPayer` | `ABRA_FLEXI_VAT_PAYER` | no       | `false` | Flip once the business registers as VAT-payer (plátce DPH).    |

## What it does

1. `payment.captured` fires (payment id in the event payload).
2. Resolve the order linked to that payment.
3. If `order.metadata.abra_flexi_invoice_id` is already set, skip to step 7 — no
   duplicate invoice, but payment recording still runs.
4. Map the order to an Abra Flexi invoice payload (line items, customer, optional IČO/DIČ).
5. Create the invoice in Abra Flexi. Transient failures (network, 5xx) are retried
   automatically by Medusa's workflow engine; 4xx failures (bad payload, auth) fail
   the workflow run visibly instead of retrying — check Medusa's workflow execution
   log for manual reconciliation.
6. Persist `abra_flexi_invoice_id` / `abra_flexi_invoice_code` onto `order.metadata`.
7. Mark the invoice paid: if the payment id is already in
   `order.metadata.abra_flexi_recorded_payment_ids`, stop — already recorded.
8. Otherwise, `PUT` the invoice's payment status (`stavUhrK`) to Abra Flexi's
   "paid manually" code. Same retry/failure behavior as invoice creation.
9. Append the payment id to `order.metadata.abra_flexi_recorded_payment_ids`.

## Known gaps (by design, deferred)

- **Reduced/mixed VAT rates.** Only the basic 21% rate is supported, and only once
  `ABRA_FLEXI_VAT_PAYER=true`. The business is currently a non-VAT-payer, so this
  doesn't apply yet — revisit when it does.
- **Storefront IČO/DIČ capture.** The mapper reads `order.metadata.ico` /
  `order.metadata.dic` if present, but nothing in the storefront sets them yet
  (B2C only, today). Small fast-follow once B2B checkout is needed.
- **Credit notes, general ledger.** Separate sub-projects (3-4) of the Abra
  Flexi milestone — not built here. Payment status (sub-project 2) is built,
  via a direct field write, not a linked bank record — see
  `docs/superpowers/research/2026-09-06-abra-flexi-payment-api-verification.md`
  for why, and what upgrading to a bank-record-based approach would need.
- **Settlement-completeness / reconciliation.** Payment status is _asserted_,
  not derived: the first capture on an order writes Abra Flexi's "paid
  manually" status onto the whole invoice, regardless of whether that capture
  covered the full invoice total (e.g. a partial/split-tender payment).
  Nothing here computes "is this invoice fully paid" or cross-checks captured
  amounts against invoice totals — under the direct-field-write approach
  (see the gap above), there isn't a partial-paid state to compute into. A
  periodic reconciliation job, or moving to the bank-record-based approach
  that lets Abra Flexi track partial settlement itself, is a documented
  stretch goal, not built.
- **Wire-format field names.** `datVyd`/`splatnost`/`mena`/customer fields are
  verified against Abra Flexi's public docs; the line-items shape
  (`polozkyFaktury`/`faktura-vydana-polozka`) is corroborated by a community
  reference but has no first-party JSON example for this evidence type.
  Separately, the generated `externalCode` (`order-<id>`, sent as the record's
  `id` field prefixed `code:`) is roughly 32 characters for a real Medusa order
  id — Abra Flexi's `kod` field, which that `code:` prefix addresses, has
  undocumented-here length and allowed-charset constraints, also unverified.
  Run `pnpm --filter @medusa-cz/invoicing-abraflexi test:integration` against a
  real sandbox instance (set `ABRA_FLEXI_*` env vars) before relying on either
  of these in production, and fix up field names / the external-code format
  here if the sandbox disagrees.

## Manual acceptance (once registered with real credentials)

1. Place and pay for a test order (Comgate/GoPay sandbox, or manual capture via
   the admin API).
2. Confirm an invoice appears in Abra Flexi with the right customer, line items,
   and total.
3. Confirm `order.metadata.abra_flexi_invoice_id` is set on the Medusa order.
4. Trigger a second `payment.captured` for the same order (e.g. a partial second
   capture) and confirm no duplicate invoice is created.
