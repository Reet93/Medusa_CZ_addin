# @medusa-cz/invoicing-abraflexi

Abra Flexi invoicing for MedusaJS 2.0 (medusa-cz). Listens for `payment.captured`
to issue and mark paid a Czech sales invoice, and for `payment.refunded` /
`order.canceled` to issue a linked credit note (dobropis) for any new Medusa
refund — all via durable, retried Medusa workflows. Idempotent throughout: a
second capture, a replayed refund event, or a second cancellation never
re-creates an invoice, payment record, or credit note already recorded, while a
genuinely new payment or refund on the same order is still recorded.

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
10. `payment.refunded` or `order.canceled` fires. Resolve the order (via the
    refunded payment's `payment_collection_id` for the former; directly for
    the latter).
11. If `order.metadata.abra_flexi_invoice_id` isn't set, stop — no invoice
    exists yet to correct (e.g. the order was canceled before ever being
    captured).
12. List every refund across every payment on the order and diff against
    `order.metadata.abra_flexi_recorded_refund_ids`; stop if there's nothing
    new.
13. For each new refund (oldest first): build a credit-note payload — a full,
    negated mirror of the original invoice's lines when triggered by
    `order.canceled`, or a single lump-sum "Refund" line for the refunded
    amount when triggered by `payment.refunded` — then create it in Abra
    Flexi and link it to the original invoice (two sequential `PUT`s to the
    same `faktura-vydana.json` endpoint). Same retry/failure behavior as
    invoice creation; a failure on the link step surfaces as a visible
    workflow failure describing the now-orphaned credit note, for manual
    reconciliation.
14. Append each newly recorded refund id to
    `order.metadata.abra_flexi_recorded_refund_ids`.

## Known gaps (by design, deferred)

- **Reduced/mixed VAT rates.** Only the basic 21% rate is supported, and only once
  `ABRA_FLEXI_VAT_PAYER=true`. The business is currently a non-VAT-payer, so this
  doesn't apply yet — revisit when it does.
- **Storefront IČO/DIČ capture.** The mapper reads `order.metadata.ico` /
  `order.metadata.dic` if present, but nothing in the storefront sets them yet
  (B2C only, today). Small fast-follow once B2B checkout is needed.
- **General ledger.** Sub-project 4 of the Abra Flexi milestone — not built
  here. Credit notes (sub-project 3) are built — see "What it does" above.
- **Returns/exchanges as a credit-note trigger.** Only a real Payment-module
  refund (the admin "Refund payment" action, or a full order cancellation)
  produces a credit note. Medusa's own return/exchange/claim workflows in
  this version don't call the real refund-payment path at all — they
  produce order-level "credit lines" instead, a different, non-money ledger
  adjustment this package doesn't react to. See
  `docs/superpowers/research/2026-09-07-abra-flexi-credit-notes-api-verification.md`
  Part 2 for the full trace. If this business's RMA process relies on that
  flow alone, no credit note is produced — a real gap, not a guess.
- **Orphaned/unlinked credit-note reconciliation.** If a credit note is
  created in Abra Flexi but the follow-up link call (or the refund-id
  persistence step) then fails non-retryably, nothing here detects or
  auto-repairs it later — it's a visible workflow failure at the time, for
  manual reconciliation in Abra Flexi directly. A periodic reconciliation
  job is a documented stretch goal, not built.
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
  Separately, `typDokl: code:DOBROPIS` (credit notes, sub-project 3) carries
  the same unverified-by-default caveat as `code:FAKTURA` — confirm both via
  the live sandbox suite.

## Manual acceptance (once registered with real credentials)

1. Place and pay for a test order (Comgate/GoPay sandbox, or manual capture via
   the admin API).
2. Confirm an invoice appears in Abra Flexi with the right customer, line items,
   and total.
3. Confirm `order.metadata.abra_flexi_invoice_id` is set on the Medusa order.
4. Trigger a second `payment.captured` for the same order (e.g. a partial second
   capture) and confirm no duplicate invoice is created.
