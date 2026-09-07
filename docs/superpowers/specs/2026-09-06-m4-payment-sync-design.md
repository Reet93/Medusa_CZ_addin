# M4 sub-project 2 — Abra Flexi payment recording (`@medusa-cz/invoicing-abraflexi`)

**Status:** design approved 2026-09-06. Second of four sub-projects in the
Abra Flexi invoicing/bookkeeping milestone (see
`2026-09-02-m4-abra-flexi-invoicing-design.md` §8 for the original
decomposition and the note that motivated this sub-project).

## Goal

When a Medusa payment is captured, record the resulting payment/settlement
against the Abra Flexi invoice that `createInvoiceInAbraFlexiWorkflow`
already created for it — so Abra Flexi shows the invoice as paid, not just
issued.

## Why this isn't a no-op

Invoice creation is itself triggered by `payment.captured`
(`create-invoice-in-abra-flexi.ts`), so "invoice issued" and "payment
captured" happen at the same instant for this system today. That makes this
sub-project's original framing ("payment status sync" for later status
changes, e.g. a bank transfer clearing after issuance) not quite the gap
that exists in practice yet — the real, present gap is simpler: `createInvoice`
only ever sends invoice line items and customer data. It never tells Abra
Flexi that money arrived. Left alone, every invoice this system creates sits
in Abra Flexi as issued/unpaid indefinitely, regardless of the real payment
state in Medusa. This sub-project closes that gap by writing a second fact
(the settlement) immediately after the first (the invoice), not by polling
or reacting to a later async status change.

## Decisions (this session)

- **Trigger & sequencing:** `subscribers/payment-captured.ts` runs
  `recordPaymentInAbraFlexiWorkflow` **sequentially after**
  `createInvoiceInAbraFlexiWorkflow`, in the same handler. This guarantees
  the invoice already exists (its id is what the payment record links to)
  with no polling or race condition — if invoice creation throws, the
  handler never reaches the payment step, which is the correct behavior
  (never record a payment against an invoice that doesn't exist).
- **Idempotency: per-payment, not per-invoice.** Considered and rejected a
  single boolean flag (`abra_flexi_payment_recorded: true`) because Medusa's
  order/payment model already allows **split-tender payments** — multiple
  payment sessions on one order (e.g. part gift card, part card), each
  firing its own `payment.captured` event for the same order but a
  different payment id. The existing invoice-creation workflow already
  designed around this (its idempotency guard makes every capture after the
  first a no-op, since one invoice covers the whole order total regardless
  of how it's paid). For payment _recording_, the equivalent no-op-the-rest
  approach would silently drop real settlement data for split-tender orders.
  Instead: `order.metadata.abra_flexi_recorded_payment_ids: string[]` tracks
  which payment ids have already been recorded; the workflow's guard step
  checks membership in that array rather than a single flag. This also
  means the design is forward-compatible with a payment provider adding
  real partial-capture support later (each capture is just another payment
  id to record) without a redesign.
- **Explicitly not built: settlement-completeness tracking.** No running
  total, no "is this invoice fully paid yet" computation on our side. Abra
  Flexi's own ledger already sums whatever payment records it's given
  against an invoice; duplicating that math here would be speculative
  complexity aimed at a question Abra Flexi already answers. Revisit only if
  a real need to _query_ that state from Medusa's side ever appears.
- **Capture amount:** v1 asserts the captured amount matches what's being
  recorded (the payment's own amount, from the Payment module) — no
  cross-checking against the invoice total or flagging over/underpayment.
  That kind of reconciliation is exactly the stretch-goal periodic job
  below, not this workflow's job.
- **Reconciliation job — explicit stretch goal, not this sub-project.** A
  scheduled job comparing Medusa payment records against Abra Flexi invoice
  status to catch drift is valuable but different in kind (batch, not
  event-driven) and unmotivated until real drift is observed in practice.
  Tracked here so it isn't lost, not scheduled.

## 1. Abra Flexi client — [High]

- New method on `AbraFlexiClient`: `recordPayment(payload): Promise<{ id: string }>`.
- **Verified** (`docs/superpowers/research/2026-09-06-abra-flexi-payment-api-verification.md`):
  two documented, mutually-exclusive ways exist — a direct `stavUhrK`
  field write on the invoice ("Option A"), or creating a linked `banka`
  bank-movement record via `sparovani` matching ("Option B", requires a
  real registered bank account entity in Abra Flexi and pulls forward
  general-ledger scope from sub-project 4).
- **Decision (this session):** implement **Option A** — `PUT` to the
  existing `faktura-vydana.json` endpoint (already used by `createInvoice`),
  setting `stavUhrK: "code:stavUhr.paidRucne"` on the invoice looked up by
  its `externalCode`. This business doesn't manage real bank/cash records
  in Abra Flexi yet (confirmed this session); Option A is Abra Flexi's own
  documented recommendation for that case, needs no new evidence type or
  bank-account entity, and reuses the existing endpoint.
- **Deliberately swappable, not a dead end:** the workflow layer (§2) only
  depends on `recordPayment`'s signature, not its internal HTTP call — so
  upgrading to Option B later (once real bank-statement reconciliation
  starts in Abra Flexi) is a change confined to this method's
  implementation, not a workflow redesign or data migration. Note this
  explicitly in the method's code comment so a future reader doesn't
  mistake the simple field-write for the final architecture.
- Same error-handling shape as `createInvoice`: typed `AbraFlexiApiError`,
  5xx retryable, 4xx not.

## 2. Workflow — [High]

`recordPaymentInAbraFlexiWorkflow(input: { paymentId: string })`. Note: no
`invoiceId`/`invoiceCode` in the input — Option A's `stavUhrK` write only
needs the invoice's `externalCode`, which is deterministically re-derivable
from the order (`` `order-${order.id}` ``, the same derivation
`createInvoice`'s payload already uses) once the workflow resolves its own
order from the payment id. This also means the workflow doesn't need
anything passed to it from `createInvoiceInAbraFlexiWorkflow`'s result —
sequencing (§3) is about ordering, not data flow between the two.

1. **Step: resolve order.** Same payment-id → order resolution as
   `createInvoiceInAbraFlexiWorkflow` (reused, not reimplemented).
2. **Idempotency guard (inline, not a separate step).** If `paymentId` is
   already present in `order.metadata.abra_flexi_recorded_payment_ids`,
   skip the remaining steps.
3. **Step: record payment.** Calls `AbraFlexiClient.recordPayment` with the
   invoice's external code (derived from the resolved order). Retry config
   for transient failures (same `maxRetries`/`retryInterval` shape as
   `createInvoiceStep`); non-retryable errors fail the workflow visibly, no
   silent drop.
4. **Step: persist result.** Append `paymentId` to
   `order.metadata.abra_flexi_recorded_payment_ids` (read-modify-write the
   array, not a blind overwrite — must not clobber prior entries for
   split-tender orders).

No compensation step — nothing is mutated before step 3, same reasoning as
the invoice-creation workflow.

## 3. Subscriber — [High]

`subscribers/payment-captured.ts` is extended (not duplicated into a second
subscriber) to run both workflows in sequence:

```
await createInvoiceInAbraFlexiWorkflow(container).run({ input: { paymentId: data.id } })
await recordPaymentInAbraFlexiWorkflow(container).run({ input: { paymentId: data.id } })
```

Still no business logic in the subscriber itself — both workflows own their
own steps and guards.

## 4. Testing & acceptance — [High]

TDD per repo discipline (RED → GREEN → REFACTOR), matching the existing
`create-invoice-in-abra-flexi` suite:

- `abra-flexi-client.test.ts` — extended with `recordPayment` mocked-HTTP
  cases (success, 4xx, 5xx), against the verified `stavUhrK` field write.
- `record-payment-in-abra-flexi.test.ts` — idempotency guard (repeat
  `paymentId` is a no-op; a _different_ `paymentId` on the same order is
  **not** a no-op, proving split-tender correctness), retry behavior,
  persisted array append (not overwrite).
- DB-backed idempotency-guard integration test, same style and same real
  Postgres setup as the existing `invoicing-abraflexi` DB-backed suite
  (`test:integration`) — proves the guard survives a real workflow-engine
  run, not just an in-memory mock.
- Opt-in live suite extension (skipped unless `ABRA_FLEXI_*` credentials are
  set) — never fires a real payment record in the default CI gate.

**Package gate:** `pnpm --filter @medusa-cz/invoicing-abraflexi test` green,
typecheck + build clean, before wiring the extended subscriber into
`apps/backend/medusa-config.ts`'s already-registered module.

## 5. Out of scope (YAGNI) — [High]

- Periodic reconciliation job (stretch goal — track if real drift appears).
- Settlement-completeness computation ("is this invoice fully paid") on
  Medusa's side.
- Sub-project 3 — credit notes / refunds (dobropis on `payment.refunded`).
- Sub-project 4 — general ledger / bookkeeping entries.

## Acceptance summary

- Every `payment.captured` event that successfully creates or resolves an
  invoice also results in exactly one Abra Flexi payment record per unique
  payment id, idempotently, with retry-on-transient-failure via the
  workflow engine.
- Split-tender orders (multiple captures, one order) get one payment record
  per capture, none dropped, none duplicated.
- Package test gate green; subscriber wiring extended in
  `apps/backend/medusa-config.ts`'s existing module registration — no new
  module registration needed.
