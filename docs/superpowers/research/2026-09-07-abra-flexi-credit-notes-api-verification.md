# Abra Flexi credit-notes API verification

Verifies, against Abra Flexi's own public docs (`podpora.flexibee.eu`) **and**
against the actual installed `@medusajs/core-flows@2.17.0` source in this
repo's `node_modules` (not just Medusa's public docs, which don't say which
internal workflow emits which event), the two open questions in
`docs/superpowers/specs/2026-09-07-m4-credit-notes-design.md`: what Abra Flexi
calls a credit note and how it links to an invoice, and which real Medusa
event(s) this sub-project can actually rely on as a trigger.

## Part 1 — Abra Flexi: what a credit note is and how it's created

### Document type and endpoint

A credit note in Abra Flexi is called **dobropis** (for a customer-facing
sales credit) — the underlying document kind is described as an "opravný
daňový doklad" (ODD, corrective tax document), used to adjust a previously
issued invoice's tax base/tax:

> "A dobropis (credit note) or opravný daňový doklad (ODD - corrective tax
> document) serves to correct issued invoices when it's necessary to adjust
> the tax base or the tax itself... in cases of complaints with goods
> returns."
> — <https://podpora.flexibee.eu/cs/articles/6379282-dobropis-wui>

Critically, **a credit note is not a separate evidence/endpoint** — it's the
same `faktura-vydana` (issued invoice) evidence this package's
`AbraFlexiClient.createInvoice` already PUTs to, just with a different
`typDokl` (document type) code:

> "Credit notes use the same **faktura-vydana** (issued invoice) endpoint as
> regular invoices... The document type code is `code:DOBROPIS`."
> — <http://podpora.flexibee.eu/en/articles/4744457-credit-notes>

So the same `PUT /c/{company}/faktura-vydana.json` this package already
calls is the right endpoint — no new evidence type, no new client base URL.

### Linking to the original invoice

The field that connects a credit note to the invoice it corrects is
`dobropisovanyDokl` ("the document being credited"), sent inside a
`vytvor-vazbu-dobropis` ("create credit-note link") block, addressing the
original invoice the same way this package already addresses records —
by its `code:` value (i.e., this package's existing `externalCode` /
`abraFlexiExternalCodeForOrder(orderId)`):

```json
{
  "winstrom": {
    "faktura-vydana": {
      "id": "code:DOBROPIS1",
      "vytvor-vazbu-dobropis": {
        "dobropisovanyDokl": "code:FAKTURA1"
      }
    }
  }
}
```

(shown here as JSON; Abra Flexi's own docs give this as XML — this package
already sends JSON to the same endpoint for `createInvoice`/`recordPayment`,
and Abra Flexi's REST API accepts either for the same evidence)

Constraints, verified from the same source:

> "A single credit note can only be linked to one invoice. However, multiple
> credit notes can be linked to a single invoice." ... "If a credit note is
> already linked to an invoice and should be linked to another, the import
> will end with an error."
> — <http://podpora.flexibee.eu/en/articles/4744457-credit-notes>

This one-credit-note-to-one-invoice, many-credit-notes-per-invoice shape is
exactly what makes **per-refund** idempotency (not per-invoice, not
per-payment) the correct granularity — see the design spec's idempotency
section, which mirrors this 1:1.

### Two ways to build one — verified, and why this sub-project needs Option B

Abra Flexi's own docs describe **two different request shapes** for
producing a linked credit note, confirmed from the same "Credit Notes"
article's two side-by-side XML examples:

**Option A — single-step, item-id-based (`dobropisuj`).** Create the
`faktura-vydana` record with `typDokl: code:DOBROPIS` and a `dobropisuj`
block that both names the original invoice (`dobropisovanyDokl`) _and_
selects which of the _original invoice's own line items_ (by their Abra
Flexi-assigned internal `id`, plus a quantity) to credit, in one call:

```xml
<faktura-vydana>
  <typDokl>code:DOBROPIS</typDokl>
  <dobropisuj>
    <dobropisovanyDokl>code:VF1-0001/2021</dobropisovanyDokl>
    <polozkyDokladu>
      <polozka>
        <id>123</id>
        <mnozMj>1</mnozMj>
      </polozka>
    </polozkyDokladu>
  </dobropisuj>
</faktura-vydana>
```

**Option B — two-step, own-items + explicit link (`vytvor-vazbu-dobropis`).**
Create the `faktura-vydana` record with `typDokl: code:DOBROPIS` and its
_own_ freely-built `polozkyFaktury` line items (the same shape
`createInvoice` already builds) in one PUT, then a second PUT against the
same record (`id: code:<its own code>`) carrying only the
`vytvor-vazbu-dobropis.dobropisovanyDokl` link field:

```xml
<!-- PUT #1: create, with its own items (typDokl + polozkyFaktury) -->
<!-- PUT #2, same record id, adds only the link: -->
<faktura-vydana>
  <id>code:DOBROPIS1</id>
  <vytvor-vazbu-dobropis>
    <dobropisovanyDokl>code:FAKTURA1</dobropisovanyDokl>
  </vytvor-vazbu-dobropis>
</faktura-vydana>
```

Both are documented at
<http://podpora.flexibee.eu/en/articles/4744457-credit-notes> and
<https://demo.flexibee.eu/devdoc/dobropisy>.

**Decision (this session): implement Option B.** Option A's
`polozkyDokladu.polozka.id` requires the _original invoice's own internal
Abra Flexi line-item ids_ — but this package's `createInvoice` (and its
`AbraFlexiInvoiceResult` return type: `{ id, code }`) never captures or
persists per-line-item ids from invoice creation today. Building on Option A
would mean adding a whole new capability (fetch + store per-item ids from
every invoice at creation time) before a single credit note could be built.
Option B needs none of that: the credit note carries its own line items
(reusing the exact same `polozkyFaktury`-building code `createInvoice`
already has), and links to the original purely by its existing `code:`
value. The cost is a second PUT per credit note (create, then link) — the
same two-call shape this package already has precedent for
(`createInvoice` then `recordPayment`, two separate PUTs to the same
endpoint for two different facts).

### Negative-quantity sign convention (verified)

Abra Flexi's manual-creation docs are explicit about what actually encodes
"this is a credit", and it is **not** a distinct amount-sign field on the
document — it's the ordinary line-item quantity going negative:

> "...second, essential element of creating a dobropis, is negative quantity
> of its items."
> — <https://podpora.flexibee.eu/cs/articles/5633916-dobropis-gui>

This means the existing per-line `typCenyDphK`/`typSzbDphK` VAT-rate fields
`createInvoice` already attaches (gated on `config.vatPayer`, unchanged from
today) need no new "negative VAT" variant — a negative `mnozMj` (quantity)
with the same unit price and same VAT-rate-code fields is sufficient; Abra
Flexi computes a negative tax base/tax amount server-side from that. No new
VAT field to verify beyond what `ABRA_FLEXI_VAT_RATE_CODE_BASIC` already is.

### Not verified against a live instance

Per this package's own established discipline (see `README.md`'s "Known
gaps" section re: `FAKTURA`'s `kod`/length constraints) — the following are
documented, but not confirmed against this business's real Abra Flexi
company, and should be checked with `pnpm test:integration`'s live sandbox
suite before this ships:

- Whether `typDokl: "code:DOBROPIS"` exists by default in a fresh Abra Flexi
  company the same way `code:FAKTURA` apparently does, or needs one-time
  setup (a "typ faktury" with druh/kind = "Dobropis") before the API can use
  it. Check via `GET /c/{company}/typ-faktury.json` or a live-fire test,
  same as the payment-sync research's outstanding `banka`/`typDokl`
  caveat for Option B there.
- Whether Option B's two PUTs must genuinely be sequential/separate calls,
  or whether `polozkyFaktury` + `vytvor-vazbu-dobropis` could be sent
  together in a single PUT when the record's own `code:` is chosen upfront.
  Abra Flexi's docs present them as two ordered examples and never states
  outright that combining them fails, but never confirms it succeeds either
  — implement as two sequential PUTs (the documented shape) rather than
  guessing they can be merged.

## Part 2 — Medusa: which real event(s) trigger this, verified from source

The task brief asks "refund created? order canceled? partial vs full?" —
this is answerable precisely, and only, by reading the actual
`@medusajs/core-flows@2.17.0` workflow source installed in this repo's
`node_modules` (Medusa's public event-reference docs list event names and
payloads, but not which internal workflow variant actually fires them, which
turns out to matter a lot here — see below).

### The two real trigger events

Confirmed in
`node_modules/.pnpm/@medusajs+utils@2.17.0.../dist/core-flows/events.js`:

```js
exports.PaymentEvents = {
  CAPTURED: "payment.captured",
  REFUNDED: "payment.refunded",   // payload: { id } -- the PAYMENT's id, not a refund id
};
exports.OrderWorkflowEvents = {
  ...
  CANCELED: "order.canceled",     // payload: { id } -- the ORDER's id
  ...
};
```

Grepping the entire `@medusajs/core-flows@2.17.0` `dist/` tree for where each
is actually emitted (`emitEventStep` calls) found **exactly one emitter for
each**:

- `PaymentEvents.REFUNDED` ("payment.refunded") — emitted only from
  `dist/payment/workflows/refund-payment.js` (`refundPaymentWorkflow`,
  **singular**), the workflow backing the Admin API's
  `POST /admin/payments/:id/refund` route — an admin-initiated refund
  against one specific payment, for any amount up to what's captured on it
  (full or partial).
- `OrderWorkflowEvents.CANCELED` ("order.canceled") — emitted only from
  `dist/order/workflows/cancel-order.js` (`cancelOrderWorkflow`), backing
  `POST /admin/orders/:id/cancel`.

Both payloads carry only an id (matching this package's own event style —
`payment.captured`'s payload is likewise just `{ id }`), so this
sub-project's workflow must re-resolve everything else (which refunds exist,
their amounts) from the container, exactly the way
`create-invoice-in-abra-flexi.ts`'s `resolveOrderStepFn` already re-resolves
the order from a bare payment id rather than trusting event payload shape.

### The gap that isn't optional to know about: order cancellation never fires `payment.refunded`

Reading `cancel-order.js` in full: cancelling an order runs
`refundCapturedPaymentsWorkflow.runAsStep(...)` (which real-refunds every
already-captured payment on the order) and separately cancels any
_uncaptured_ payments — then emits **only** `order.canceled`:

```js
const [refundedPayments] = parallelize(
  refundCapturedPaymentsWorkflow.runAsStep({ input: { order_id: order.id, ... } }),
  deleteReservationsByLineItemsStep(lineItemIds),
  cancelPaymentStep({ paymentIds: uncapturedPaymentIds }),
  emitEventStep({ eventName: OrderWorkflowEvents.CANCELED, data: { id: order.id } })
)
```

Tracing `refundCapturedPaymentsWorkflow` →
`dist/order/workflows/payments/refund-captured-payments.js` → it calls
`refundPaymentsWorkflow.runAsStep(...)` — the **plural**
`dist/payment/workflows/refund-payments.js`. That file was also grepped for
`emitEventStep`/`PaymentEvents.REFUNDED`: **it has none.** The plural
refund-payments workflow calls `refundPaymentsStep` (the actual
`paymentModuleService.refundPayment` calls, which do create real `RefundDTO`
rows) and writes order transactions, but never emits `payment.refunded`.

**Consequence, verified not guessed:** an order cancellation in this Medusa
version genuinely refunds captured payments (real `RefundDTO` rows appear,
retrievable via `paymentModuleService.listRefunds({ payment_id })`), but
**no `payment.refunded` event fires for it.** A subscriber listening only to
`payment.refunded` would silently miss every credit note that order
cancellation should produce. This is why the design spec has this
sub-project subscribe to **both** `payment.refunded` and `order.canceled`,
funneling both into the same "diff the order's refunds against what's
already recorded" logic — neither event's payload is trustworthy alone for
"is there a new refund to credit", so both paths do the same re-resolution
work regardless of which one fired.

### Returns, exchanges, claims — the same grep found no third path here

`OrderWorkflowEvents` also defines `RETURN_REQUESTED`, `RETURN_RECEIVED`,
`CLAIM_CREATED`, and `EXCHANGE_CREATED`. Grepping
`@medusajs/core-flows@2.17.0`'s `order/` tree for any use of
`refundPaymentWorkflow`/`refundPaymentsWorkflow`/`refundCapturedPaymentsWorkflow`
found **only** `cancel-order.js` — none of the return/claim/exchange
workflows in this version call into the payment-refund workflows at all.
Instead, Medusa's own return/exchange/claim processing produces **"refund
credit lines"** (`createOrderRefundCreditLinesWorkflow` —
`dist/order/workflows/payments/create-order-refund-credit-lines.js`), a
different, order-level ledger adjustment that is not the same thing as a
`RefundDTO` against a real payment. `cancel-order.js` itself also calls this
same credit-lines workflow, but only _in addition to_ its real payment
refunds (to true up any Medusa-side "pending difference" from order edits),
not instead of them.

**This is a real, source-confirmed gap, not a guess:** if this business's
actual RMA process for partial returns goes through Medusa's
return/exchange flow expecting Abra Flexi to automatically get a dobropis
out of it, **it won't**, under this design — only a real Payment-module
refund (via the admin "Refund payment" action, or a full order cancellation)
triggers a credit note here. See the design spec's open questions for what
to ask before relying on this.

### Refund data shape (verified from `@medusajs/types@2.17.0`)

`RefundDTO` (`dist/payment/common.d.ts`) — what's actually available per
refund:

```ts
export interface RefundDTO {
  id: string
  amount: BigNumberValue
  raw_amount?: BigNumberValue
  refund_reason_id?: string | null
  refund_reason?: RefundReasonDTO | null
  note?: string | null
  created_at: Date
  created_by?: string
  // ... (payment relation)
}
```

No line-item or order-line breakdown exists on a refund — `CreateRefundDTO`
(`dist/payment/mutations.d.ts`) likewise takes only `payment_id`, `amount`,
an optional `refund_reason_id`/`note` — refunding in Medusa is amount-based,
not item-based, at the Payment module level. This is why the design spec's
partial-refund credit note is a single lump-sum line, not an attempt to
reconstruct which order line items were refunded — that data doesn't exist
at this layer to reconstruct from.

`IPaymentModuleService.listRefunds(filters, config)` (`dist/payment/service.d.ts`)
supports `payment_id` as a filter — the mechanism this sub-project's
workflow uses to enumerate a payment's (or, across a `query.graph` join, an
order's) refunds.

## Sources

- <http://podpora.flexibee.eu/en/articles/4744457-credit-notes>
- <https://podpora.flexibee.eu/cs/articles/6379282-dobropis-wui>
- <https://podpora.flexibee.eu/cs/articles/5633916-dobropis-gui>
- <https://demo.flexibee.eu/devdoc/dobropisy>
- <https://podpora.flexibee.eu/cs/articles/4538946-vydana-faktura> (issued-invoice field reference, same as the payment-sync research's Option A source)
- This repo's installed `@medusajs/utils@2.17.0`:
  `node_modules/.pnpm/@medusajs+utils@2.17.0_*/node_modules/@medusajs/utils/dist/core-flows/events.js`
  (`PaymentEvents`, `OrderWorkflowEvents` definitions)
- This repo's installed `@medusajs/core-flows@2.17.0`:
  `node_modules/.pnpm/@medusajs+core-flows@2.17.0_*/node_modules/@medusajs/core-flows/dist/{payment/workflows/refund-payment.js,payment/workflows/refund-payments.js,order/workflows/cancel-order.js,order/workflows/payments/refund-captured-payments.js}`
  (traced to find every real `emitEventStep` for `PaymentEvents.REFUNDED` /
  `OrderWorkflowEvents.CANCELED`, and to confirm the plural refund-payments
  workflow emits neither)
- This repo's installed `@medusajs/types@2.17.0`:
  `node_modules/.pnpm/@medusajs+types@2.17.0_*/node_modules/@medusajs/types/dist/payment/{common.d.ts,mutations.d.ts,service.d.ts}`
  (`RefundDTO`, `CreateRefundDTO`, `listRefunds` shape)
