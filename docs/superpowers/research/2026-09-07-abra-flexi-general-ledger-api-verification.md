# Abra Flexi general ledger API verification

Verifies what "general ledger" (sub-project 4 of the Abra Flexi milestone,
see `docs/superpowers/specs/2026-09-02-m4-abra-flexi-invoicing-design.md`
§8) actually means against Abra Flexi's own docs and live API schema —
that spec explicitly left this sub-project's shape unresolved ("needs its
own requirements pass on how deep Medusa should drive the actual books vs.
handing Abra Flexi clean invoices it books itself"). This doc is that
requirements pass, done the same way `2026-09-06-abra-flexi-payment-api-verification.md`
verified sub-project 2: against Abra Flexi's own public docs
(`podpora.flexibee.eu`) and, where possible, the live public demo
instance's own schema (`demo.flexibee.eu`), not from memory.

**Headline finding:** Abra Flexi's general ledger (`ucetni-denik`, "účetní
deník") is a derived, read-only report assembled automatically from source
documents — invoices among them — not a place this plugin (or anything
else) writes to directly. The real open question isn't "what do we write,"
it's "does this business's Abra Flexi company already have the one-time
configuration in place that makes the invoices this plugin already creates
post to that ledger automatically" — which is a fact about the live
production company, not something resolvable from public documentation
alone. See the companion spec for how that shapes the sub-project.

## 1. `ucetni-denik` (the general ledger) is read-only via REST — confirmed live

Abra Flexi's own evidence registry, fetched live from the public demo
instance, lists the accounting-journal evidence explicitly as **import
disallowed**:

```
ucetni-denik  (dbName: UcetniDenik)  "Účetní deník"  — Import support: DISALLOWED
```

— <https://demo.flexibee.eu/c/demo/evidence-list> (fetched live this session)

This matches Abra Flexi's own English-language description of the feature
(titled, in English, literally "General Ledger" — `uctovny-dennik` redirects
there):

> The General Ledger "provides a view of entries from all accounting
> documents" and consolidates entries from "accounting documents, asset
> depreciation, repayment schedules, and lease tax expenses."
> — <https://podpora.flexibee.eu/en/articles/4585700-general-ledger>

That article documents it purely as a printable/reportable output (its
"Basic Output Fields" list — Module, Posting status, Debit account, Credit
account, Cost center, etc. — matches a report view, not a document schema)
reached through the Accounting module's "Accounting Outputs" screen, with
no mention of a REST write path. Combined with the evidence-list's explicit
`DISALLOWED` import flag, this rules out candidate 3 from this
sub-project's original framing ("a distinct accounting-document evidence
separate from `faktura-vydana`") for the general ledger itself: there is no
such write target, by Abra Flexi's own design — it's meant to be populated
automatically from source documents, never authored directly.

(One inconsistency worth flagging: fetching `ucetni-denik`'s own
`properties.json` schema shows individual fields such as `mdUcet`,
`dalUcet`, `zuctovano`, `stredisko` marked `isWritable: true` at the
field-metadata level. That's schema metadata about the field, not proof the
evidence accepts a REST `PUT`/import — the evidence-list's own
`Import support: DISALLOWED` flag is the more authoritative signal, and is
consistent with every prose description of this evidence being a report.
Anyone implementing against this should still expect a live `PUT` attempt
to `ucetni-denik.json` to fail, but that expectation is not itself proven
by a live write attempt in this pass — flagging it as unverified-by-attempt
rather than overclaiming.)

## 2. `faktura-vydana` already carries everything needed to post — verified live schema

Fetching `faktura-vydana`'s real `properties.json` from the public demo
instance (live this session, not from memory) confirms the exact
accounting-related fields Abra Flexi's invoice-issued evidence carries:

| `propertyName` | `dbName`      | label (`name`)                 | type       |
| -------------- | ------------- | ------------------------------ | ---------- |
| `zuctovano`    | `Zuctovano`   | Zaúčtováno ("Stav zaúčtování") | `logic`    |
| `ucetni`       | `Ucetni`      | Je účetní                      | `logic`    |
| `datUcto`      | `DatUcto`     | Datum zaúčtování               | `date`     |
| `stredisko`    | `IdStred`     | Středisko                      | `relation` |
| `typUcOp`      | `IdTypUcOp`   | Předpis zaúčtování             | `relation` |
| `primUcet`     | `IdPrimUcet`  | Účet MD                        | `relation` |
| `protiUcet`    | `IdProtiUcet` | Účet DAL                       | `relation` |

— <https://demo.flexibee.eu/c/demo/faktura-vydana/properties.json> (fetched
live this session)

`zuctovano` ("Zaúčtováno") is the field that answers "has this invoice
posted to the ledger" — a boolean, readable via `GET` on any invoice, no
guessing needed for what to check.

**`stredisko` (cost center) is mandatory for posting, but self-defaults —
verbatim, in Czech, from Abra Flexi's own docs:**

> "Umožňuje doklad zařadit v rámci střediskového členění účtované firmy.
> Pro zaúčtování dokladu je nezbytné pole vyplnit i v případě, kdy firma
> střediskové členění nepoužívá (v takovém případě je automaticky zvoleno
> středisko s názvem 'Centrála')."
> — <https://podpora.flexibee.eu/cs/articles/4538946-vydana-faktura>

Translation: the field is required for posting, but if the company doesn't
use cost-center segmentation at all (this business's case — nothing in
this codebase or the milestone's specs so far mentions cost centers), Abra
Flexi automatically substitutes a center named "Centrála." This plugin's
`createInvoice` payload has never set `stredisko` and doesn't need to for
this reason — same "no VAT line until VAT-payer" style of a field being
genuinely optional given this business's actual configuration, not an
oversight.

**`typUcOp` (posting rule) is configured once, on the invoice _type_, not
per invoice:**

> Posting rules are set up per "Issued Invoice Type," on that type's
> "Accounting" tab (menu path: Sales – Posting Rules – Posting Rules –
> Issued Invoices); once configured, "the system then automatically
> applies these rules to individual invoices created with that type."
> — <https://podpora.flexibee.eu/en/articles/4549288-posting-rules-issued-invoices>
> (English redirect of `4549288-pravidla-uctovania-vydane-faktury`)

And confirmed structurally: this plugin already sends `typDokl:
"code:FAKTURA"` on every invoice it creates (`abra-flexi-client.ts`
`createInvoice`). That field is a `relation` to the **`typ-faktury-vydane`**
evidence (confirmed via the live `faktura-vydana` schema: `typDokl` →
`fkEvidencePath: "typ-faktury-vydane"`, label "Typ faktury") — i.e. a
specific, named "FAKTURA" record in that evidence, in the real production
Abra Flexi company, is exactly where a posting rule would need to be
configured for every invoice this plugin issues to inherit one
automatically. This plugin's payload never needs to carry `typUcOp` itself
for that inheritance to work — Abra Flexi's own docs describe the values
as "transferred" from the document type onto the document
(<https://podpora.flexibee.eu/en/articles/4538522-general-document-properties>,
English redirect of `4538522-vseobecne-vlastnosti-dokumentu`: "posting
template and cost center, transferred from document type").

**What is NOT independently confirmed by a directly-quotable article in
this pass:** whether an invoice becomes `zuctovano: true` _immediately_,
automatically, the moment its posting rule and cost center are both
resolvable (vs. requiring some separate manual "post" action even when the
data is complete). Two separate Czech-language web searches both
surfaced this claim in their synthesized summaries ("if all accounting
data — pre-accounting and cost center — are preset, [the document] is
automatically posted immediately after creation, and the 'posted' field is
set accordingly"), citing flexibee.eu/podpora.flexibee.eu results, but a
direct fetch of the two most likely source articles
(`4538946-vydana-faktura`, `4538522-general-document-properties`) could not
locate that exact sentence to quote verbatim. Treat this as **plausible,
not proven** — the `zuctovano` field (§2 above) is real and checkable, but
whether it flips to `true` automatically for this plugin's invoices needs a
live create-then-read-back check against the real target company (see the
spec's Option A), not a doc citation. (One unrelated product line also
surfaced in search — `help.abra.eu`, "ABRA Gen" — is a _different_ ERP
product from the same vendor, not Abra Flexi/FlexiBee; excluded from this
verification as not authoritative for this API.)

## 3. No separate "accounting document" evidence this plugin should write to

Two other accounting-adjacent evidences exist and were checked:

- **`interni-doklad`** (`dDoklInt`, "Interní doklady" — internal
  documents) — genuine manual/general journal entries with no invoice
  behind them (month-end adjustments, depreciation, provisions,
  corrections). Listed in the live evidence registry with
  `Import support: NOT_DOCUMENTED` (neither confirmed supported nor
  explicitly disallowed, unlike `ucetni-denik`'s `DISALLOWED`). Nothing
  in Medusa's domain model maps to "post an arbitrary manual journal
  entry" — there's no order, payment, or refund event that corresponds to
  a depreciation entry or a bookkeeping correction. This is squarely an
  accountant's own task in Abra Flexi's UI, not something a Medusa plugin
  should originate.
- **`predpis-zauctovani`** (`uTypUcOp`, "Předpisy zaúčtování" — posting
  rules themselves) — also exists as a live evidence
  (`Import support: NOT_DOCUMENTED`). Technically an API write path may
  exist, but Abra Flexi's own docs describe configuring these once, by a
  human, on the invoice-type record (§2) — not a per-order or per-payment
  concern an event-driven Medusa workflow should manage.
- <https://demo.flexibee.eu/c/demo/evidence-list> (fetched live this
  session) is the source for both.

## 4. Rozúčtování (accounting-row breakdown) — re-confirmed out of scope, now with a concrete reason

The 2026-09-06 payment-sync research doc flagged
`6713877-rozuctovani-dokladu-pomoci-rest-api` as "unrelated — covers
accounting-row breakdown, not payment matching" without fully explaining
why it doesn't apply here either. Fetching it this session confirms the
concrete reason:

> "Funkci rozúčtování dokladu lze použít jen u dokladu, který neobsahuje
> položky" — the accounting-breakdown function only applies to a document
> that has **no line items**.
> — <https://podpora.flexibee.eu/cs/articles/6713877-rozuctovani-dokladu-pomoci-rest-api>

This plugin's invoices always carry `polozkyFaktury` (line items) —
`abra-flexi-client.ts`'s `createInvoice` always populates it, even for a
single-line order. So this REST feature structurally does not apply to any
document this plugin creates; it's not a gap, it's inapplicable by
construction.

## 5. Open items — cannot be resolved from documentation alone

- **Is the "FAKTURA" `typ-faktury-vydane` record, in the real production
  Abra Flexi company, already configured with a posting rule?** This is a
  fact about a specific live company's configuration, set once through
  Abra Flexi's own UI (Sales – Posting Rules – Posting Rules – Issued
  Invoices) by whoever set up that company — not discoverable from public
  docs, and not something this codebase can infer. Resolvable only by
  looking at the real company (asking the business/accountant) or a live
  API check.
- **Does `zuctovano` actually flip to `true` immediately on invoice
  creation when the above is configured?** Plausible per search-summarized
  docs (§2) but not confirmed with a directly quotable source in this
  pass — needs a live create-then-`GET` check, the same "verify against
  the real sandbox, don't guess" discipline this repo already applies
  (e.g. the payment-sync doc's Option B `banka`/`typDokl` gap, and this
  package's README note on `polozkyFaktury`/`externalCode` needing a real
  sandbox run before production reliance).

## Sources

Fetched live this session (first-party, current):

- <https://demo.flexibee.eu/c/demo/evidence-list>
- <https://demo.flexibee.eu/c/demo/faktura-vydana/properties.json>
- <https://demo.flexibee.eu/c/demo/ucetni-denik/properties.json>
- <https://podpora.flexibee.eu/cs/articles/4538946-vydana-faktura>
- <https://podpora.flexibee.eu/en/articles/4585700-general-ledger> (English
  redirect of `4585700-uctovny-dennik`)
- <https://podpora.flexibee.eu/en/articles/4549288-posting-rules-issued-invoices>
  (English redirect of `4549288-pravidla-uctovania-vydane-faktury`)
- <https://podpora.flexibee.eu/en/articles/4538522-general-document-properties>
  (English redirect of `4538522-vseobecne-vlastnosti-dokumentu`)
- <https://podpora.flexibee.eu/cs/articles/6713877-rozuctovani-dokladu-pomoci-rest-api>

Referenced via search-engine synthesis, not independently confirmed with a
direct verbatim quote in this pass (see §2's caveat and §5):

- The "auto-posts immediately once resolvable" behavioral claim, and the
  "Basic pre-accounting" default-rule fallback mention, both surfaced
  across two Czech-language web searches citing `flexibee.eu`/
  `podpora.flexibee.eu` results, but the exact source sentence could not be
  located on direct re-fetch of the most likely candidate articles.

Explicitly ruled out as not authoritative for this API (different product,
same vendor):

- `help.abra.eu` ("ABRA Gen" — a separate desktop ERP product line, not
  Abra Flexi/FlexiBee) — excluded from this verification despite surfacing
  in search results for "předkontace."
