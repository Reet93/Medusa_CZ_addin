# M4 sub-project 3 — Abra Flexi credit notes (`@medusa-cz/invoicing-abraflexi`)

**Status:** design drafted 2026-09-07. Third of four sub-projects in the
Abra Flexi invoicing/bookkeeping milestone (see
`2026-09-02-m4-abra-flexi-invoicing-design.md` §8 for the original
decomposition). Sub-project 2 (payment recording) is a sibling effort in
flight at the same time — this design doesn't depend on it being merged
first, but does reuse the same patterns it established
(`resolveOrderStepFn` reuse, a per-unit `string[]` idempotency array on
`order.metadata`, a client method that PUTs to the existing
`faktura-vydana.json` endpoint).

## Goal

When a Medusa order's payment is refunded (fully or partially) — whether via
an explicit admin payment refund, or as a side effect of canceling the whole
order — issue a corresponding Abra Flexi credit note (dobropis / opravný
daňový doklad) **linked to** the original invoice
`createInvoiceInAbraFlexiWorkflow` already created for that order, rather
than silently editing or leaving stale the original invoice.

## Why this isn't simple, and what changed since sub-project 1's framing

The original decomposition (`2026-09-02` design, §8) framed this as
reacting to `PaymentEvents.REFUNDED` alone. Verifying that assumption
against this repo's actual installed `@medusajs/core-flows@2.17.0` source
(not just Medusa's public docs) found it's **not sufficient by itself** —
see
`docs/superpowers/research/2026-09-07-abra-flexi-credit-notes-api-verification.md`
Part 2 for the full trace, summarized here:

- `payment.refunded` fires only from the **singular** `refundPaymentWorkflow`
  (the Admin API's "refund a payment" action) — payload `{ id: payment.id }`.
- Canceling an order (`POST /admin/orders/:id/cancel`,
  `cancelOrderWorkflow`) auto-refunds every already-captured payment on the
  order through a _different_, **plural** `refundPaymentsWorkflow` internal
  path — which creates real `RefundDTO` rows but **never emits
  `payment.refunded`**. Only `order.canceled` fires (payload
  `{ id: order.id }`).
- Medusa's own return/exchange/claim workflows in this version don't call
  either refund workflow at all — they produce "refund credit lines" (an
  order-level ledger adjustment), not real `RefundDTO` rows.

So "one event, one handler" (sub-project 2's shape, since invoice creation
and payment capture really do coincide in this system) doesn't hold here:
**two** distinct events can each be the only signal that a refund happened,
and neither carries the data needed to act on it directly. Both funnel into
the same core logic below.

## Decisions (this session)

- **Trigger: subscribe to both `payment.refunded` and `order.canceled`,
  same downstream workflow.** Verified from source (see research doc) that
  these are the only two events in this Medusa version that can precede a
  real Payment-module refund existing on an order, and that neither implies
  the other reliably. Both subscribers resolve to an order id and hand off
  to the same `createCreditNoteInAbraFlexiWorkflow(input: { orderId })` —
  there is exactly one place that decides what a credit note should look
  like, regardless of which event triggered it.
- **Neither event payload is used for anything but resolving an order.**
  `payment.refunded`'s `{ id }` is a payment id → resolved to its order via
  the same `payment_collection_id` join `resolveOrderStepFn` already uses.
  `order.canceled`'s `{ id }` already _is_ the order id. Once an order is
  resolved, both paths do identical work from there: list every refund
  across every payment on that order and diff against what's already been
  turned into a credit note. This is deliberate — trusting event payload
  shape for "what refund, how much" would mean re-deriving Abra Flexi state
  from data Medusa's own event system doesn't actually promise (see the
  research doc's `RefundDTO` shape — no line items, no "is this final"
  flag), so the workflow re-queries the Payment module directly instead,
  the same reasoning `resolveOrderStepFn` already applies to
  `payment.captured`.
- **Idempotency: per Medusa refund id, not per-payment, not per-event.**
  `order.metadata.abra_flexi_recorded_refund_ids: string[]`. Reasoning,
  mirroring sub-project 2's split-tender-payment reasoning exactly but for
  refunds: a single payment can accumulate multiple partial `RefundDTO`
  rows over time (a customer gets money back twice, say), and Abra Flexi's
  own docs confirm a single invoice can have **multiple** linked credit
  notes (verified — see research doc Part 1) but each credit note links to
  exactly **one** invoice. Per-refund-id tracking is the natural 1:1 match
  to that shape: one new `RefundDTO` in, one new Abra Flexi credit note
  out, ever. A per-payment or per-order boolean would silently drop a
  second partial refund on the same payment/order, exactly the failure mode
  sub-project 2 already reasoned through and rejected for payment capture.
- **How new refunds are discovered: diff, not the event payload.** The
  workflow's guard step queries all refunds across all payments on the
  resolved order (`paymentModuleService.listRefunds({ payment_id: [...] })`
  for every payment id on the order, or an equivalent `query.graph` join —
  implementer's choice, not a design constraint), then filters out any
  whose `id` is already in `abra_flexi_recorded_refund_ids`. Every refund
  id that remains gets its own credit note, in the same workflow run. This
  makes both trigger events converge on identical logic and makes a
  duplicate/replayed event (either kind) naturally a no-op once its
  refund(s) are already recorded — no separate per-event dedup needed.
- **Precondition: an Abra Flexi invoice must already exist.** If
  `order.metadata.abra_flexi_invoice_id` isn't set (order canceled before
  ever being captured/invoiced — a real, ordinary case, since
  `cancelOrderWorkflow` also cancels _uncaptured_ payments with nothing to
  credit), skip entirely. There is nothing to link a credit note to, and no
  invoice was ever issued for Abra Flexi to correct.
- **Abra Flexi API shape: Option B (two-step create-then-link), not Option
  A.** Verified in the research doc: Option A (`dobropisuj` with
  `polozkyDokladu.polozka.id`) needs the _original_ invoice's own internal
  Abra Flexi line-item ids, which `createInvoice`'s result
  (`AbraFlexiInvoiceResult { id, code }`) never captures today. Option B
  creates the credit note with its own freely-built `polozkyFaktury` (reuse
  of the exact line-building shape `createInvoice` already has) via one
  `PUT`, then links it to the original invoice via a second `PUT` carrying
  `vytvor-vazbu-dobropis.dobropisovanyDokl: code:<original invoice's
externalCode>`. Same endpoint (`faktura-vydana.json`) both times — no new
  evidence type, matching sub-project 2's "reuse the existing endpoint"
  precedent.
- **The credit note gets its own `externalCode`, deterministically derived
  — a new helper alongside `abraFlexiExternalCodeForOrder`.**
  `creditNoteExternalCodeForRefund(orderId, refundId)` →
  `` `order-${orderId}-credit-${refundId}` ``. This gives Abra Flexi's own
  idempotent-upsert-by-`code` behavior a second line of defense underneath
  this workflow's own metadata-array guard, exactly the same defense-in-depth
  property `abraFlexiExternalCodeForOrder(orderId)` already gives invoice
  creation and payment recording.
- **Line items — two shapes, chosen by which event triggered the run, not
  by computing "is this the last refund":**
  - **Order-cancellation path (`order.canceled`):** mirror the _original
    Medusa order's_ line items and shipping lines (reusing
    `mapOrderToAbraFlexiInvoice`'s line-building logic, not duplicating it)
    with **negated quantities** — a full, honest storno of everything that
    was originally billed. This is correct here specifically because
    `cancelOrderWorkflow` refunds the _entirety_ of every captured payment
    on the order (verified in the research doc — `refundCapturedPaymentsWorkflow`
    computes `amountToRefund = capturedAmount - refundedAmount` per
    payment, i.e., whatever hasn't already been refunded, in full).
  - **Explicit payment-refund path (`payment.refunded`):** a **single
    lump-sum line** (quantity `-1`, unit price = the refund's `amount`),
    VAT-flagged the same `config.vatPayer` way regular lines already are.
    This is not a simplification of convenience — it's what the data
    actually supports: `RefundDTO`/`CreateRefundDTO` carry only a total
    `amount`, no order-line breakdown (verified in the research doc), so
    there is no line-accurate partial credit note buildable from what this
    event's refund record contains. Labeled generically (e.g. a "Refund"
    line, optionally incorporating the refund's `note`/`refund_reason` if
    present) rather than guessing which product was returned.
  - **Explicitly not attempted:** detecting "this partial refund happens to
    sum to 100% of the invoice" from a `payment.refunded`-triggered run and
    upgrading it to a full item-mirror. The branch is tied to _which event
    fired_, not to a computed running total — keeps the rule simple and
    avoids a wrong guess when a sequence of unrelated partial refunds
    happens to add up to the total by coincidence.
- **VAT:** identical mechanism to today's invoice mapper — no new field,
  no new rate code. A negative quantity is what Abra Flexi itself uses to
  encode a correction (verified in the research doc — not a separate
  amount-sign flag), so the existing `typCenyDphK`/`typSzbDphK` gating on
  `config.vatPayer` carries over unchanged onto credit-note lines.
- **Currency:** taken from the order, same as invoice creation — no new
  decision; this package already assumes one currency per order.
- **No compensation step.** Same reasoning as `createInvoiceInAbraFlexiWorkflow`
  and `recordPaymentInAbraFlexiWorkflow`: nothing external is mutated before
  the create-credit-note API call, and once Abra Flexi has accepted it,
  rolling back would mean deleting a real accounting document — not
  something a failed _later_ step (e.g., persisting the recorded-refund-id)
  should trigger automatically. A failure after the create-and-link calls
  succeed but before persistence should be caught by a retry of the whole
  workflow re-discovering the same "already exists in Abra Flexi, not yet
  in our array" state — see Open questions below for the gap this leaves.

## 1. Abra Flexi client — [High]

- New method on `AbraFlexiClient`:
  `createCreditNote(payload): Promise<{ id: string; code: string }>`.
- **Verified** (`docs/superpowers/research/2026-09-07-abra-flexi-credit-notes-api-verification.md`):
  same `faktura-vydana.json` endpoint `createInvoice`/`recordPayment`
  already use; `typDokl: "code:DOBROPIS"` marks the record as a credit
  note; line items use the existing `polozkyFaktury` shape with negated
  quantities; a second `PUT` with `vytvor-vazbu-dobropis.dobropisovanyDokl`
  links it to the original invoice by `code:`.
- Two sequential HTTP calls internally (create, then link) — not exposed
  as two separate client methods; `createCreditNote` owns both PUTs and
  only resolves once the record is both created _and_ linked, so callers
  never see a half-linked credit note as a success.
- **Not verified against a live instance** (flagged explicitly, not
  guessed past): whether `code:DOBROPIS` exists in this business's Abra
  Flexi company by default, and whether the two PUTs must really be
  sequential or could be merged. See research doc's "Not verified against
  a live instance" section. Both should be confirmed by
  `pnpm --filter @medusa-cz/invoicing-abraflexi test:integration` against
  the real sandbox before this ships to production traffic — same
  discipline as sub-project 1's `FAKTURA`/`kod` caveat and sub-project 2's
  live-sandbox task.
- Same error-handling shape as `createInvoice`/`recordPayment`: typed
  `AbraFlexiApiError`, 5xx retryable, 4xx not. If the create PUT succeeds
  but the link PUT fails non-retryably, the credit note document now exists
  in Abra Flexi unlinked — surfaced as a visible workflow failure for
  manual reconciliation (an orphaned dobropis is a mess a human should see
  and fix in Abra Flexi directly, not something this package should try to
  auto-delete or auto-retry-link indefinitely).

## 2. Order → credit-note mapping — [High]

Two small, pure functions, both taking the same shape of input
`mapOrderToAbraFlexiInvoice` already does (`order`, `config`), so they're
trivially unit-testable without HTTP or a Medusa container — the same
highest-value test surface sub-project 1 already established:

- `mapOrderToFullCreditNote(order, config, refundId)` — reuses
  `mapOrderToAbraFlexiInvoice`'s item + shipping line construction, negates
  every line's `quantity`, sets `externalCode` to
  `creditNoteExternalCodeForRefund(order.id, refundId)`.
- `mapRefundToLumpSumCreditNote(order, config, refund)` — single line,
  `quantity: -1`, `unitPrice: refund.amount`, same `externalCode` helper,
  same `vatPayer` gating as regular lines.

Both return the same `AbraFlexiInvoicePayload` shape credit notes need
(no new payload type — `createCreditNote` sends it with `typDokl:
DOBROPIS` and the link step, everything else about the shape is identical
to an invoice payload).

## 3. Workflow — [High]

`createCreditNoteInAbraFlexiWorkflow(input: { orderId: string })`:

1. **Step: resolve order.** By order id directly (both trigger paths
   arrive here already holding an order id — `payment.refunded` resolves
   its payment id to an order first via the existing
   `resolveOrderStepFn`-style join, `order.canceled`'s payload already is
   one). Fetches enough fields to know: `abra_flexi_invoice_id` /
   `abra_flexi_invoice_code`, `abra_flexi_recorded_refund_ids`, every
   payment id on the order, order items/shipping (for the full-mirror
   case).
2. **Guard: no invoice, no-op.** If `abra_flexi_invoice_id` isn't set,
   return immediately — nothing to credit.
3. **Step: list refunds, diff against recorded ids.** Query
   `paymentModuleService.listRefunds({ payment_id: <every payment id on
the order> })` (or an equivalent join), filter to refund ids **not**
   already in `abra_flexi_recorded_refund_ids`. If none remain, no-op —
   this is what makes a duplicate/replayed `payment.refunded` _or_
   `order.canceled` a safe no-op regardless of which one fired twice.
4. **Per new refund (in order of `created_at`, oldest first — so a
   replayed run processes them in a stable, predictable order):**
   a. **Step: build the credit-note payload.** Full-mirror shape if this
   workflow run was triggered by `order.canceled`, lump-sum shape if
   triggered by `payment.refunded` — the workflow's `input` carries
   which one it was (`triggeredBy: "order_canceled" |
"payment_refunded"`), not inferred from data.
   b. **Step: create the credit note.** Calls
   `AbraFlexiClient.createCreditNote`. Retry config matching
   `createInvoiceStep`/`recordPaymentStep` (transient retried, 4xx
   permanent failure, visible in the workflow log).
   c. **Step: persist.** Append this refund's id to
   `order.metadata.abra_flexi_recorded_refund_ids` (read-modify-write,
   never a blind overwrite — must not clobber prior entries, same
   non-clobbering requirement sub-project 2 already established for
   `abra_flexi_recorded_payment_ids`).

No compensation step (see Decisions above for why).

## 4. Subscribers — [High]

Two new, thin subscribers, both delegating to the same workflow — no
business logic in either, matching this package's established
thin-subscriber pattern:

- `subscribers/payment-refunded.ts`, `event: "payment.refunded"`. Resolves
  the payment id to an order id (same join `resolveOrderStepFn` already
  does for `payment.captured`), then runs
  `createCreditNoteInAbraFlexiWorkflow(container).run({ input: { orderId,
triggeredBy: "payment_refunded" } })`.
- `subscribers/order-canceled.ts`, `event: "order.canceled"`. The event
  payload's `id` already is the order id — runs
  `createCreditNoteInAbraFlexiWorkflow(container).run({ input: { orderId:
data.id, triggeredBy: "order_canceled" } })` directly, no resolution
  step needed.

Both are new files — `payment-captured.ts` is not extended further here
(unlike sub-project 2's chaining into the same subscriber): a refund and a
capture are different events on different occasions, not two facts that
always happen together in one request the way invoice-creation and
payment-recording currently do.

## 5. Testing & acceptance — [High]

TDD per repo discipline (RED → GREEN → REFACTOR), matching the existing
`create-invoice-in-abra-flexi` / (in-flight) `record-payment-in-abra-flexi`
suites' style and the mocked-`fetch` pattern in `abra-flexi-client.test.ts`:

- `abra-flexi-client.test.ts` — extended with `createCreditNote` mocked-HTTP
  cases: the two-PUT sequence (create then link), success, a 4xx on the
  create PUT, a 4xx on the link PUT (distinguishing "never created" from
  "created but orphaned"), 5xx retryability for both.
- `order-to-invoice-mapper.test.ts` (or a new sibling file) —
  `mapOrderToFullCreditNote` and `mapRefundToLumpSumCreditNote`, exhaustively:
  negated quantities, `vatPayer` on/off, `creditNoteExternalCodeForRefund`'s
  exact format.
- `create-credit-note-in-abra-flexi.test.ts` — idempotency guard (a refund
  id already in the recorded array is skipped; a _different_, new refund id
  on the same order is **not** skipped, proving multi-partial-refund
  correctness), the no-invoice-yet no-op, the `triggeredBy`-selected line
  shape, retry behavior, persisted array append (not overwrite).
- `payment-refunded.test.ts` / `order-canceled.test.ts` — each subscriber
  resolves the right order id and calls the workflow with the right
  `triggeredBy`.
- DB-backed idempotency-guard integration test, same style and same real
  Postgres setup as the existing `invoicing-abraflexi` DB-backed suite
  (`test:integration`) — proves the per-refund-id guard survives a real
  workflow-engine run, exercising at least two refunds on the same order to
  prove the second one isn't dropped.
- Opt-in live suite extension (skipped unless `ABRA_FLEXI_*` credentials
  are set) — this is the step that actually answers the two "not verified
  against a live instance" items in §1/the research doc; never fires a
  real credit note in the default CI gate.

**Package gate:** `pnpm --filter @medusa-cz/invoicing-abraflexi test`
green, typecheck + build clean, before wiring both new subscribers into
`apps/backend/medusa-config.ts`'s already-registered module (no new module
registration needed — same as sub-project 2).

## 6. Open questions — flagged explicitly, not guessed

These are real gaps this session could not close from documentation or
source alone — they need an answer from whoever runs this business, or a
live-sandbox test, before this ships, the same way the payment-sync
research flagged its Option A/B business-process question rather than
picking one silently:

1. **RESOLVED (2026-09-11, continued session) — decided against Medusa's
   Returns/Exchanges feature; direct refund/cancel stays the RMA process.**
   Jakub's call, made with the actual current plugin stack considered
   (verified this session: Packeta's `createReturnFulfillment` and this
   package's credit-note subscriber already both work correctly with
   Returns too, so integration cost wasn't the deciding factor — customer
   self-service and exchange support were, and at current volume aren't
   worth the storefront UI work yet). Practical effect: this design's
   original assumption holds cleanly — every refund is an explicit "Refund
   payment" action, so `payment.refunded` always fires and a credit note is
   always produced; the silent-no-credit-note risk this question originally
   flagged (Returns settling via credit lines instead of a real refund)
   never gets exercised. Revisit only if return/exchange volume ever makes
   the manual process painful enough to reconsider — see `local.md`'s
   2026-09-11-continued session update for the full comparison that led here.
2. **Does `typDokl: "code:DOBROPIS"` exist by default in this business's
   Abra Flexi company?** Documented as a standard document-type code, but
   this session found no confirmation it's present without setup in every
   company (parallel to `code:FAKTURA`'s similar unverified status noted in
   this package's README). Check via a live-sandbox call before relying on
   it.
3. **Can Option B's create-and-link be safely merged into one PUT, or must
   it stay two?** Documented as two ordered examples; neither documented as
   forbidden nor confirmed combinable. Implement as two sequential PUTs
   (the safe, documented shape) and only attempt combining them later if a
   live-sandbox test confirms it works — not from reading the docs alone.
4. **What happens to a credit note that's created in Abra Flexi but whose
   link PUT then fails non-retryably (or whose id-persistence step fails
   after both PUTs succeed)?** This design surfaces it as a visible,
   manually-reconciled workflow failure rather than attempting automatic
   cleanup (see §1) — but there's no automated detection today for "an
   unlinked or unrecorded dobropis exists in Abra Flexi that this system
   doesn't know about." Acceptable for v1 (matches sub-project 2's
   "reconciliation job is a stretch goal, not built" stance), but worth
   naming here rather than pretending the retry story is airtight.

## 7. Out of scope (YAGNI) — [High]

- **Sub-project 4 — general ledger / bookkeeping entries.** Unrelated
  subsystem, unchanged scope boundary from the original decomposition.
- **Returns/exchanges/claims as a direct trigger.** Not built — see Open
  question 1, resolved: RMA stays direct refund/cancel, so this was never
  needed. Revisit only if that decision changes; if it does and the RMA
  process ends up using Medusa's real refund-payment action, no new
  sub-project is needed (this design already handles it via
  `payment.refunded`) — only if it settles via credit lines instead would
  that be a distinct future sub-project (reacting to Medusa's credit-line
  events instead/also), not a small
  addition to this one.
- **Automatic reconciliation of orphaned/unlinked Abra Flexi credit
  notes.** Explicit stretch goal, not this sub-project's job — see Open
  question 4 and sub-project 2's identical stance on payment-recording
  reconciliation.
- **Merging the create-and-link Option B calls into one PUT.** Stays two
  sequential calls until a live sandbox test proves otherwise (Open
  question 3).
- **Reduced/mixed VAT rates on credit notes.** Same deferral as the rest of
  this package — irrelevant while `ABRA_FLEXI_VAT_PAYER=false`.

## Acceptance summary

- Every new Medusa `RefundDTO` discovered on an order that already has an
  Abra Flexi invoice results in exactly one linked Abra Flexi credit note,
  idempotently, regardless of whether it was discovered via `payment.refunded`
  or `order.canceled`.
- A full order cancellation produces a credit note that mirrors the
  original invoice's line items (negated); an explicit partial/full
  single-payment refund produces a single lump-sum credited line for the
  refunded amount.
- A second refund on the same order (a further partial refund, or a
  cancellation after a prior partial refund) produces a second, independent
  credit note — never silently dropped, never duplicated for a refund
  already recorded.
- An order with no Abra Flexi invoice yet produces no credit note.
- Package test gate green; both new subscribers wired into
  `apps/backend/medusa-config.ts`'s existing module registration — no new
  module registration needed.
