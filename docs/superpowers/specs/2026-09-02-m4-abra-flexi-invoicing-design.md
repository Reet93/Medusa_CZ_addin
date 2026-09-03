# M4 — Abra Flexi invoice issuance (`@medusa-cz/invoicing-abraflexi`)

**Status:** design approved 2026-09-02. First of four sub-projects in the
Abra Flexi invoicing/bookkeeping milestone; see "Out of scope" for the rest.

## Goal

Replace the never-implemented `@medusa-cz/invoicing-fakturoid` skeleton
(bare `MedusaService({})`, no-op subscriber) with a real invoicing module
that issues a sales invoice in Abra Flexi automatically when a Medusa order's
payment is captured.

## Why Abra Flexi, and why replace Fakturoid outright

Decision (this session): the target Czech accounting system is being changed
from Fakturoid to Abra Flexi. Since the Fakturoid package never grew past an
M0 skeleton (no invoicing logic, no tests, no client), there is nothing to
migrate — this is a fresh build against a different API, not a refactor.
`packages/invoicing-fakturoid` is renamed to `packages/invoicing-abraflexi`
and rebuilt from scratch following the `payment-comgate` package's structure
(client / module / workflow / subscriber / tests), the proven TDD-built
pattern in this repo.

## Approach (chosen)

**Medusa Workflow with steps**, invoked from a `payment.captured` subscriber
— not a direct API call inline in the subscriber, and not a custom
outbox/scheduled-job pattern.

Rejected alternatives:

- **Direct call from the subscriber.** Simplest, matches the old skeleton's
  shape, but a transient Abra Flexi outage silently drops the invoice with
  nothing to retry or surface.
- **Outbox + scheduled job.** Most resilient, gives a natural home for a
  future manual-reconciliation view, but requires new infrastructure (a
  pending-invoice table, a cron job) this milestone doesn't need yet.

The workflow approach wins because this project's `medusa-config.ts` already
registers `workflow-engine-redis` — step state is durably persisted and
retried by the framework for free, no new infrastructure required. It also
matches how Medusa's own core (`capturePaymentWorkflow`) does side-effecting
work, and gives payment-sync/credit-notes (sub-projects 2–3) a matching shape
to extend rather than a new pattern to invent.

## Decisions (this session)

- **Trigger:** `payment.captured` (Medusa event `PaymentEvents.CAPTURED`,
  verified in this repo's pinned `@medusajs/core-flows@2.17.0` /
  `@medusajs/utils@2.17.0`: `capturePaymentWorkflow` emits
  `eventName: "payment.captured"`, payload `{ id }` — the **payment** id,
  not the order id). Chosen over `order.placed` (the old skeleton's trigger)
  for correctness: a Czech tax invoice should reflect payment received, not
  merely an order existing.
- **VAT status:** business is currently **neplátce** (not VAT-registered).
  Modeled as a config flag `ABRA_FLEXI_VAT_PAYER` (bool, default `false`),
  not hardcoded — the business may register as **plátce** later, and this
  must be a config flip, not a redesign.
- **B2B (IČO/DIČ):** not needed today (B2C only), but "possible in future,
  both B2B and B2C." The order→invoice mapper and Abra Flexi client accept
  optional IČO/DIČ (validated with the existing `isValidIco` in
  `packages/shared/src/cz/ico.ts`) read from order metadata if present.
  **Explicitly out of scope for this sub-project:** the storefront checkout
  UI to capture IČO/DIČ. That's a small, separate fast-follow once B2B
  actually activates — building it now would be speculative (YAGNI).
- **Idempotency:** an order may receive multiple/partial payment captures.
  The workflow's first step checks `order.metadata.abra_flexi_invoice_id`;
  if already set, it's a no-op returning the existing id. This also makes
  workflow-step retries safe.

## 1. Package structure — [High]

Rename `packages/invoicing-fakturoid` → `packages/invoicing-abraflexi`.
Delete the Fakturoid skeleton's `src/` contents; scaffold fresh, following
`payment-comgate`'s layout:

```
packages/invoicing-abraflexi/
  src/
    core/
      abra-flexi-client.ts       # REST wrapper: auth, createInvoice()
      abra-flexi-client.test.ts
      order-to-invoice-mapper.ts # pure function: Order + config -> AbraFlexiInvoicePayload
      order-to-invoice-mapper.test.ts
    workflows/
      create-invoice-in-abra-flexi.ts
      create-invoice-in-abra-flexi.test.ts
    subscribers/
      payment-captured.ts
    modules/
      abra-flexi/
        index.ts                 # Module registration (config schema)
        service.ts                # thin; Abra Flexi is the source of truth
    types.ts
  README.md
```

Update `CLAUDE.md` / `AGENTS.md` package list line accordingly
(`packages/invoicing-fakturoid — Fakturoid invoicing module` →
`packages/invoicing-abraflexi — Abra Flexi invoicing module`).

## 2. Abra Flexi client — [High]

- Config (env, mirrors Comgate/Packeta's env-var pattern):
  `ABRA_FLEXI_BASE_URL`, `ABRA_FLEXI_COMPANY` (company/evidence slug —
  same REST API shape for cloud `flexibee.eu` and self-hosted, only the base
  URL differs, so this is pure config, not a design branch),
  `ABRA_FLEXI_USERNAME`, `ABRA_FLEXI_PASSWORD`, `ABRA_FLEXI_VAT_PAYER`.
- `createInvoice(payload): Promise<{ id: string; code: string }>` — POSTs to
  the invoice-issued (`faktura-vydana`) evidence endpoint, HTTP Basic auth.
  Throws a typed `AbraFlexiApiError` (status, body) on non-2xx, following
  `comgate-client.ts`'s error-handling shape.
- Unit-tested with mocked HTTP (no real Abra Flexi instance needed for the
  package test gate).

## 3. Order → invoice mapping — [High]

Pure function `mapOrderToAbraFlexiInvoice(order, config): AbraFlexiInvoicePayload`:

- Line items: product title, quantity, unit price.
- VAT: if `config.vatPayer` is `false`, no VAT line, net amount only (current
  default). If `true`, apply the standard CZ rate (21%, the current statutory
  basic rate — hardcode as a named constant, not a magic number, since it's
  set by law and changes rarely but not never) to each line. Reduced-rate
  (12%) and mixed-rate baskets are deferred — out of scope until the business
  actually registers and needs it; flag as a known gap in the README rather
  than guess at rules that don't apply yet.
- Customer: name, billing address; optional IČO/DIČ from
  `order.metadata.ico` / `order.metadata.dic` if present, validated with
  `isValidIco` before inclusion — invalid/missing values are simply omitted,
  never block invoice creation.
- Exhaustively unit-testable in isolation (no HTTP, no Medusa container) —
  the highest-value test surface in this sub-project.

## 4. Workflow — [High]

`createInvoiceInAbraFlexiWorkflow(input: { paymentId: string })`:

1. **Step: resolve order.** Payment id → order (via payment collection
   link). Fails the workflow (no retry) if the payment can't be resolved to
   an order — that's a data-integrity problem, not a transient one.
2. **Step: idempotency guard.** If `order.metadata.abra_flexi_invoice_id`
   is set, return it immediately; skip remaining steps.
3. **Step: map order to payload.** Pure, no retry needed (deterministic).
4. **Step: create invoice.** Calls `AbraFlexiClient.createInvoice`. Retry
   config for transient failures (network, 5xx) via the workflow engine's
   built-in step retry — no custom retry/backoff code. 4xx (bad payload,
   auth failure) does not retry; the workflow run fails visibly.
5. **Step: persist result.** Write `abra_flexi_invoice_id` /
   `abra_flexi_invoice_code` onto `order.metadata`.

No compensation step: nothing external is mutated until step 5, so there is
nothing to roll back on failure.

## 5. Subscriber — [High]

`subscribers/payment-captured.ts`, `event: "payment.captured"`. Resolves the
container's workflow runner and invokes
`createInvoiceInAbraFlexiWorkflow.run({ input: { paymentId: data.id } })`.
No business logic here — matches the thin-subscriber pattern already used
elsewhere in this repo.

## 6. Error handling — [Medium]

- Transient (network, Abra Flexi 5xx): retried by the workflow engine
  automatically (Redis-backed, already configured).
- Non-retryable (4xx): workflow run fails and is visible in Medusa's
  workflow execution log for manual reconciliation. No silent drops (the
  old direct-subscriber approach's failure mode).
- Multi-capture orders: idempotency guard (§4 step 2) makes a second
  `payment.captured` for an already-invoiced order a safe no-op.

## 7. Testing & acceptance — [High]

TDD per repo discipline (RED → GREEN → REFACTOR), matching the
Comgate/Packeta suites:

- `abra-flexi-client.test.ts` — mocked HTTP, auth header, success/error
  response shapes.
- `order-to-invoice-mapper.test.ts` — VAT-payer / non-payer, with/without
  IČO, missing address fields.
- `create-invoice-in-abra-flexi.test.ts` — idempotency guard, retry
  behavior, persisted metadata on success.
- Opt-in live suite (skipped unless `ABRA_FLEXI_*` live credentials are
  set), following the Comgate `test:integration` pattern — never fires a
  real invoice in the default CI gate.

**Package gate:** `pnpm --filter @medusa-cz/invoicing-abraflexi test` green,
typecheck + build clean, before registering the module in
`apps/backend/medusa-config.ts`.

## 8. Out of scope (YAGNI) — [High]

Explicitly deferred to later sub-projects/specs, per the decomposition
agreed this session:

- **Sub-project 2 — payment status sync.** Mark the Abra Flexi invoice paid
  (or link a payment record) once captured. (Note: with this design's
  trigger being `payment.captured` itself, "captured" and "invoice issued"
  are the same moment — this sub-project becomes more relevant for
  Comgate/GoPay webhook-driven status changes after issuance, e.g. a bank
  transfer clearing later. Revisit framing when scoping sub-project 2.)
- **Sub-project 3 — credit notes / refunds.** On Medusa refund
  (`PaymentEvents.REFUNDED`, also verified present in this Medusa version),
  create a credit note (dobropis) against the original invoice.
- **Sub-project 4 — general-ledger / bookkeeping entries.** Separate
  subsystem (bank/cash entries, chart of accounts, cost centers, VAT
  posting scheme) — needs its own requirements pass on how deep Medusa
  should drive the actual books vs. handing Abra Flexi clean invoices it
  books itself.
- Storefront IČO/DIČ capture UI (see "B2B" decision above).
- Reduced VAT rates / mixed-rate baskets (only relevant once
  `ABRA_FLEXI_VAT_PAYER=true` is real).

## Acceptance summary

- `payment.captured` on an order creates exactly one Abra Flexi invoice,
  idempotently, with retry-on-transient-failure via the workflow engine.
- Invoice reflects `ABRA_FLEXI_VAT_PAYER` correctly (today: no VAT line).
- Optional IČO/DIČ passthrough works when present on order metadata, without
  requiring any storefront changes in this sub-project.
- Package test gate green; module registered in `apps/backend/medusa-config.ts`
  behind real env credentials (server-side rollout is a separate, later step —
  same shape as the Packeta "neutered with dummy creds" deploy pattern).
