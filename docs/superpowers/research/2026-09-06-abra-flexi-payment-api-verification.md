# Abra Flexi payment-recording API verification

Verifies the "exact Abra Flexi entity/fields are unverified from memory"
open item in `docs/superpowers/specs/2026-09-06-m4-payment-sync-design.md`
§1, against ABRA Flexi's own public docs (`podpora.flexibee.eu`), the same
way the original VAT rate code was verified against a KB article
(`packages/invoicing-abraflexi/src/types.ts`'s `ABRA_FLEXI_VAT_RATE_CODE_BASIC`
comment).

There are **two real, documented, mutually-exclusive ways** to reflect a
payment against an issued invoice (`faktura-vydana`) in Abra Flexi. Which
one to implement is a business-process decision, not a technical one — see
"Decision needed" below.

## Option A — Direct payment-status field on the invoice

Abra Flexi's own "Vydaná faktura" (issued invoice) docs describe a
**"Payment status" drop-down field** on the invoice record itself, with
values including Unpaid / Overdue / Partially paid / Paid. The underlying
API field is `stavUhrK`, with codes including `stavUhr.uhrazeno` ("paid",
generally the computed status once real bank matching occurs) and
`stavUhr.paidRucne` ("paid manually" — the value meant for direct API
writes).

Abra Flexi's docs are explicit about when this field is appropriate:

> "If you do not manage bank and cash register records in Flexi, you can
> use the drop-down list to indicate that the invoice has been settled...
> If you **do** manage bank and cash register records, do not use this
> field — instead, match invoices with payments."
> — <https://podpora.flexibee.eu/en/articles/4538946-invoice-issued>

**Implementation shape:** a single `PUT` to the existing
`faktura-vydana.json` endpoint (already used by `createInvoice`), setting
`stavUhrK: "code:stavUhr.paidRucne"` on the existing invoice record (looked
up by its `externalCode`, same as today). No new evidence type, no bank
account entity required.

## Option B — Bank-record payment matching (`banka` + `sparovani`)

Abra Flexi's "Matching Payments in JSON Format" and "Párování plateb"
(payment matching) docs describe creating a **bank movement record**
(`banka` evidence) and linking it to the invoice via a `sparovani`
(matching) block:

```json
{
  "winstrom": {
    "banka": {
      "id": "code:BANKA1",
      "sparovani": {
        "uhrazovanaFak": {
          "@castka": "500.0",
          "@type": "faktura-vydana",
          "filter": "code:FV2"
        },
        "zbytek": "ignorovat"
      }
    }
  }
}
```

- `banka` — the bank record; can be a brand-new record (its `id` need not
  pre-exist as an imported bank-statement line) — confirmed: "the `<banka>`
  element can be a new record."
- `sparovani.uhrazovanaFak` — the invoice being paid: `@type` is the
  evidence type (`faktura-vydana`), `@castka` limits the amount applied
  from this invoice, `filter` selects the invoice (by code, matching this
  project's existing `externalCode` convention).
- `zbytek` — remainder handling: `ne`, `zauctovat`, `ignorovat`,
  `castecnaUhrada`, `castecnaUhradaNeboZauctovat`,
  `castecnaUhradaNeboIgnorovat`. Multiple `uhrazovanaFak` entries can appear
  in one `sparovani` block to settle several invoices from one payment.
- **Not yet verified:** a `banka` record also requires `typDokl` (document
  type) and `bankovniUcet` (a bank-account reference, i.e. a *real,
  pre-existing bank account entity registered in this Abra Flexi company*)
  — confirmed as required fields in general, but the exact `typDokl` code
  value to use for an incoming payment wasn't pinned down from docs alone;
  would need either a live `/c/{company}/banka/properties` call against
  the real account, or a live-fire test.

**Implementation shape:** a new endpoint (`banka.json`, not
`faktura-vydana.json`), a genuinely new evidence type this codebase has
never touched, and a dependency on a real registered bank account existing
in this Abra Flexi company.

## Decision needed

The spec's M4 decomposition already puts general-ledger/bookkeeping depth
(chart of accounts, bank/cash entries) in **sub-project 4**, explicitly
separate from this one. Building Option B here would mean building part of
sub-project 4's scope early, and only makes sense if this business is
already entering/importing real bank statements into Abra Flexi today. If
it isn't yet doing that, Option A is the documented, Abra-Flexi-endorsed
way to reflect a payment without pretending to run real bank
reconciliation the business doesn't do yet — and it reuses the existing
`faktura-vydana.json` endpoint with zero new evidence types.

**Open question for the plan:** does this business currently manage real
bank/cash records inside Abra Flexi (imported statements, reconciliation),
or is Abra Flexi being used purely for invoice issuance today (matching
this integration's current scope)? This determines A vs. B and is not
something to guess — asked directly, not assumed, per this repo's
standing rule against assuming provider specifics.

## Sources

- <http://podpora.flexibee.eu/en/articles/3852835-matching-payments-in-json-format>
- <https://podpora.flexibee.eu/cs/articles/4729375-parovani-plateb>
- <http://podpora.flexibee.eu/en/articles/4538946-invoice-issued>
- <https://podpora.flexibee.eu/cs/articles/6713877-rozuctovani-dokladu-pomoci-rest-api> (unrelated — covers accounting-row breakdown, not payment matching; ruled out)
- <https://demo.flexibee.eu/c/demo/banka/properties> (referenced by Abra's own docs as the canonical field list for `banka`; not fetched live in this pass)
