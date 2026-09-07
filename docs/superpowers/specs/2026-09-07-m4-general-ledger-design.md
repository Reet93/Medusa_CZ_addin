# M4 sub-project 4 — Abra Flexi general ledger (`@medusa-cz/invoicing-abraflexi`)

**Status:** scoping complete, implementation decision **not** locked —
2026-09-07. Fourth and last of four sub-projects in the Abra Flexi
invoicing/bookkeeping milestone (see
`2026-09-02-m4-abra-flexi-invoicing-design.md` §8 for the original
decomposition — this sub-project was explicitly left open there: "needs
its own requirements pass on how deep Medusa should drive the actual books
vs. handing Abra Flexi clean invoices it books itself"). This doc is that
requirements pass. Unlike sub-projects 2 and 3, this one doesn't end in a
single locked decision — see "Options" below and the reasoning for why.

## Goal

Figure out — and only then, if warranted, build — whatever is needed so
that invoices this plugin creates (and, once sub-project 3 ships, credit
notes) correctly post into Abra Flexi's own accounting journal / general
ledger, without this plugin duplicating bookkeeping logic that's already
Abra Flexi's job.

## Why this sub-project didn't have a clear shape yet

The other three sub-projects each started from an unambiguous gap already
observed in this codebase's behavior: no payment-status write existed
(sub-project 2), no credit-note flow existed (sub-project 3). "General
ledger" started from no such observed gap — nobody has reported that
invoices aren't showing up in Abra Flexi's books, and this codebase has
never touched anything ledger-shaped. The task was to first determine
whether a gap exists at all before designing around one, per this
milestone's original framing.

This session's research (`docs/superpowers/research/2026-09-07-abra-flexi-general-ledger-api-verification.md`)
resolves most of that ambiguity: Abra Flexi's own general ledger
(`ucetni-denik`, "účetní deník") is a **derived, read-only report**,
populated automatically from source documents — explicitly marked
import-`DISALLOWED` in Abra Flexi's own live evidence registry. There is no
API endpoint for this plugin (or anything) to "write a ledger entry" to.
What actually determines whether an invoice posts to that report is a
one-time configuration fact on the invoice's **document type**
(`typ-faktury-vydane`, record `"FAKTURA"` — the exact code this plugin
already sends as `typDokl` on every invoice), set once by a human in Abra
Flexi's own UI, not a per-invoice field this plugin's payload is missing.

That leaves exactly one real unknown, and it's not something a spec or a
plan can resolve: **has that one-time configuration already been done for
this specific business's real Abra Flexi company?** That's a fact about a
live account, not about the API. It's why this spec ends in options rather
than a locked decision — locking one now would mean guessing at a fact
that a five-minute look at the real Abra Flexi company (or a live
create-and-read-back test) settles for certain.

## What "general ledger" turned out to mean here (the three candidates, resolved)

1. **"Does invoice creation already auto-post to the ledger as a side
   effect of existing `faktura-vydana` writes, making this mostly a
   verification concern?"** — **Yes, this is the actual shape**, with one
   caveat: it depends on a one-time Abra Flexi-side configuration this
   codebase can't see (see above). This candidate is correct in kind; the
   verification research doc's §5 spells out exactly what still needs
   checking and how.
2. **"Does this need explicit `stredisko`/`typUcOp`/account-code data
   attached to invoices that isn't being set today?"** — **No, not as a
   per-invoice concern.** `stredisko` (cost center) self-defaults to
   "Centrála" when a company doesn't use cost-center segmentation (Abra
   Flexi's own documented behavior — see research doc §2), which matches
   this business (no cost-center concept exists anywhere in this
   milestone so far). `typUcOp` (posting rule) is configured once on the
   invoice **type**, not sent per document — Abra Flexi's docs describe it
   as "transferred" onto each document from its type automatically. There
   is no evidence today's invoice payload is missing a field it actually
   needs.
3. **"Is there a distinct 'accounting document' evidence separate from
   `faktura-vydana` this module should also write to?"** — **No.** The
   only other accounting-adjacent evidences are `interni-doklad` (manual
   internal journal entries — depreciation, provisions, corrections; no
   Medusa domain event maps to any of these) and `predpis-zauctovani`
   (posting-rule definitions themselves — one-time company setup, not a
   per-order concern). Neither belongs to this plugin.

## Decisions (this session)

- **Not a 5th event type.** General-ledger posting isn't triggered by any
  Medusa domain event — it's either automatic on Abra Flexi's side (once
  the document-type configuration in question is in place) or a one-time
  human configuration task in Abra Flexi's own UI. No new subscriber, no
  new workflow trigger, regardless of which option below is chosen.
- **Scope boundary — squarely out of a Medusa plugin's job:** an
  accountant manually classifying or adjusting ledger entries in Abra
  Flexi's UI, month-end closing entries, depreciation schedules, VAT
  control-statement generation, and chart-of-accounts management. None of
  these have a corresponding Medusa order/payment/refund event to hang a
  subscriber off of — building toward them would mean inventing
  Medusa-side concepts (a "ledger adjustment" domain object, say) that
  don't exist and aren't asked for anywhere in this milestone.
- **The one real open item is empirical, not architectural:** whether the
  `"FAKTURA"` `typ-faktury-vydane` record in the actual production Abra
  Flexi company already carries a configured posting rule. Nothing in this
  repo, this session's research, or Abra Flexi's public docs can answer
  that — it needs either a look at the real company/a conversation with
  whoever administers it, or the live check in Option A below.

## Options — not locked, evaluate against the real company before picking

### Option A — Verification-only, default recommendation

Add one opt-in live sandbox test case (same pattern as sub-project 2's
Task 6 extension of `abra-flexi-sandbox.test.ts`, skipped unless real
`ABRA_FLEXI_*` credentials are set): create a test invoice via the
existing `AbraFlexiClient.createInvoice`, then `GET` it back
(`faktura-vydana/<id>.json` or a query by `externalCode`) and assert on
its `zuctovano` field (verified real field name — see research doc §2).

- If `zuctovano === true`: the business's Abra Flexi company is already
  configured correctly. Sub-project 4 closes with **no plugin code
  change** — update `README.md`'s "Known gaps" list to state general
  ledger posting is verified working, and this milestone's four
  sub-projects are done.
- If `zuctovano === false` (or the field is absent/unexpected): that's
  concrete, first-party proof the `"FAKTURA"` invoice-type record isn't
  configured with a posting rule yet in this company. The fix is a
  one-time Abra Flexi UI task for the business/accountant (Sales –
  Posting Rules – Posting Rules – Issued Invoices), **not new plugin
  code** — document this explicitly as a flagged configuration dependency
  in the README, the same way `stavUhrK`'s Option A/B choice in
  sub-project 2 was flagged as a business-process fact rather than guessed
  at.
- **What a plan for this option needs:** extend
  `packages/invoicing-abraflexi/src/__tests__/integration/abra-flexi-sandbox.test.ts`
  with a `GET` after the existing `createInvoice` case (that file already
  has the `client`/`baseUrl`/credentials scaffolding sub-project 2's Task 6
  added); a small `getInvoice`-style read method might be needed on
  `AbraFlexiClient` if one doesn't already exist by the time this is
  planned (check sub-project 2/3's landed code first — `recordPayment`'s
  `PUT` doesn't return the full record). Update the README's "Known gaps"
  section either way, per the outcome.
- **Tradeoff:** cheapest, matches this repo's standing preference for a
  live-sandbox check over a guess (this milestone's `test:integration`
  discipline exists exactly for this). Downside: nothing in this codebase
  would catch a *future* regression if someone later edits or removes that
  posting-rule configuration in Abra Flexi's UI — the opt-in test only
  runs when a developer chooses to run `test:integration` with live
  credentials, not on every deploy.

### Option B — Explicit per-invoice `typUcOp`/`stredisko`

Extend `AbraFlexiInvoicePayload` / `AbraFlexiClient.createInvoice` to
always send an explicit `typUcOp: "code:<rule>"` (and, if this business
ever adopts cost centers, `stredisko`) on every invoice — making posting
behavior a fact this plugin owns and asserts, the same shape sub-project 2
chose for `stavUhrK` (an explicit field write rather than relying on an
Abra Flexi-side default).

- Requires knowing the real `predpis-zauctovani` code value this business
  actually uses (or wants to use) — not discoverable from public docs or
  from this codebase; would need to be asked directly of the
  business/accountant, or read live via `GET predpis-zauctovani.json`
  against the real company, before it could be hardcoded the way
  `ABRA_FLEXI_VAT_RATE_CODE_BASIC` is today.
- **Tradeoff:** makes posting independent of whatever the `"FAKTURA"` type
  happens to have configured at any given moment (arguably more robust to
  drift), but duplicates a fact Abra Flexi's own docs say belongs on the
  document type, configured once — and risks this plugin silently pointing
  at a stale or wrong account/cost-center if the business's chart of
  accounts is ever restructured in Abra Flexi without this codebase being
  updated to match. Abra Flexi's own recommended pattern (configure once,
  per document type) exists specifically to avoid this class of drift.
- Worth doing only if Option A's live check comes back `false` **and** the
  business prefers a plugin-owned override over just fixing the
  configuration in Abra Flexi's UI (a straightforward one-time task in
  their existing tool either way).

### Option C — Close the sub-project on paper, no test added

If the business already knows — without needing a live check — that this
Abra Flexi company's `"FAKTURA"` type has carried a posting rule since
sub-project 1 shipped (e.g. it was part of the original account setup),
then this session's research already answers the original 2026-09-02
spec's open question ("does this need its own requirements pass" — yes,
and the answer is "there's nothing to build"). Sub-project 4 closes with
just this doc and its companion research doc as the record of that
finding.

- **Tradeoff:** zero code, fastest close-out — but ships with no runtime
  proof, ever, that invoices actually post. A future configuration change
  in Abra Flexi would regress completely silently, with no signal from
  this codebase at all (worse than Option A, which at least has an opt-in
  check someone could run on suspicion of a problem).

## Recommendation

**Option A.** It resolves the one genuine unknown (does *this* business's
Abra Flexi company already post these invoices) with the smallest
possible change, matches the milestone's established preference for a
live-sandbox check over an assumption (sub-project 2's Task 6 existed for
exactly this reason — "the whole reason Task 6 exists as a separate,
explicitly-run step rather than being folded into Task 2's mocked tests"),
and defers Option B's extra payload fields — and the business conversation
they'd require — until a live check actually proves they're needed.
Building Option B pre-emptively without that proof would be exactly the
kind of speculative complexity this milestone has already rejected once
(sub-project 2's explicit rejection of settlement-completeness tracking as
"speculative complexity aimed at a question Abra Flexi already answers").

Whoever executes this needs real `ABRA_FLEXI_*` sandbox credentials for
the actual target company to run Option A's check, and ideally five
minutes with whoever administers that company's Abra Flexi account to
confirm the `"FAKTURA"` type's posting-rule configuration directly rather
than only inferring it from `zuctovano`. Neither is resolvable from a plan
or a spec alone — this is the one place in this milestone where "verify,
don't guess" means "verify against the real account," not "verify against
public docs," because the fact in question is company-specific
configuration, not API behavior.

## Out of scope (YAGNI) — true regardless of which option is chosen

- **Writing to `ucetni-denik` directly.** Abra Flexi's own live evidence
  registry marks it import-`DISALLOWED`; it's a derived report, not a
  document to author.
- **Creating `interni-doklad` (manual internal accounting documents).** No
  Medusa domain event maps to a manual journal entry (depreciation,
  provisions, corrections) — this is squarely the accountant's own tool,
  not something a payment/order/refund-driven plugin should originate.
- **Managing `predpis-zauctovani` (posting rules) or chart-of-accounts
  records via API.** One-time company configuration, done once in Abra
  Flexi's UI by a human — not a per-order or per-payment concern for an
  event-driven workflow to own.
- **Cost-center strategy beyond the "Centrála" default.** Medusa has no
  first-class concept of Abra Flexi cost centers today (no
  sales-channel-to-`stredisko` mapping exists anywhere in this milestone),
  and inventing one now would be speculative ahead of any real multi-center
  need.
- **The `rozuctovani` (accounting-row breakdown) REST endpoint.** Only
  applies to documents saved without line items (verified — see research
  doc §4); this plugin's invoices always carry `polozkyFaktury`, so it's
  inapplicable by construction, not a deferred feature.
- **Month-end close automation, VAT control-statement generation, reduced
  VAT rates.** Already-tracked out-of-scope items elsewhere in this
  package (`README.md`'s "Known gaps", the 2026-09-02 spec's §8) —
  restated here only to confirm a "general ledger" framing doesn't
  resurrect any of them.

## Acceptance summary

Whichever option is chosen:

- No new Medusa subscriber, workflow, or event is introduced by this
  sub-project — confirmed not a "5th event type" regardless of outcome.
- `packages/invoicing-abraflexi/README.md`'s "Known gaps" section states
  general-ledger posting's actual, checked status plainly — one of
  "verified posting automatically" (Option A, happy path), "flagged
  configuration gap, business/accountant to fix in Abra Flexi's UI"
  (Option A, unhappy path), "plugin sends an explicit posting rule as of
  `<commit>`" (Option B), or "confirmed already correct by the business,
  no plugin change" (Option C) — never left silently unresolved.
- This closes the Abra Flexi milestone's fourth and final sub-project,
  either with a small, low-risk verification test (Option A) or with the
  explicit, documented finding that no further code was warranted
  (Option C) — either outcome is a real, checked answer to the original
  2026-09-02 spec's open "how deep should Medusa drive the books" question,
  not a punt.
