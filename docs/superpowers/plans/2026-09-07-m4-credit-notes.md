# Abra Flexi Credit Notes Implementation Plan (M4 sub-project 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Medusa order's payment is refunded (fully or partially) — via an
explicit admin payment refund, or as a side effect of canceling the whole order —
issue a corresponding Abra Flexi credit note (dobropis) linked to the invoice
`createInvoiceInAbraFlexiWorkflow` already created for that order, idempotently
per Medusa refund id.

**Architecture:** A new `createCreditNoteInAbraFlexiWorkflow(input: { orderId,
triggeredBy })`, same step-based shape as the existing
`createInvoiceInAbraFlexiWorkflow`/`recordPaymentInAbraFlexiWorkflow` (durable,
retried via the already-configured workflow engine). Two new, thin subscribers —
`payment-refunded.ts` (`payment.refunded`) and `order-canceled.ts`
(`order.canceled`) — both resolve an order id and delegate to this one workflow;
neither trusts its event payload for anything beyond that, since neither event's
payload carries refund amounts or line data (verified in the research doc). The
workflow re-queries every refund on the order via
`paymentModuleService.listRefunds`, diffs against
`order.metadata.abra_flexi_recorded_refund_ids`, and creates one credit note per
undiscovered refund via `AbraFlexiClient.createCreditNote` — a two-PUT
create-then-link sequence against the same `faktura-vydana.json` endpoint
`createInvoice`/`recordPayment` already use (Option B from the research doc, not
Option A). Idempotency is tracked **per refund id**, not per-payment or
per-order, mirroring sub-project 2's per-payment-id reasoning exactly.

**Tech Stack:** TypeScript, Medusa v2.17.0 workflows-sdk
(`createStep`/`createWorkflow`/`StepResponse`/`WorkflowResponse`/`when`/`transform`),
vitest, native `fetch`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-07-m4-credit-notes-design.md` — this
plan implements that spec in full; do not re-litigate its decisions. Supporting
research (verified against Abra Flexi's own docs and this repo's installed
`@medusajs/core-flows@2.17.0`/`@medusajs/types@2.17.0` source):
`docs/superpowers/research/2026-09-07-abra-flexi-credit-notes-api-verification.md`.

## Global Constraints

- Node >=20, TypeScript strict mode (`tsconfig.base.json`: `strict: true`,
  `noUncheckedIndexedAccess: true`) — every array/record index access needs a
  null check or non-null assertion.
- Medusa packages pinned to **2.17.0** across the monorepo — nothing in this
  plan changes any package's dependency versions.
- TDD per `CLAUDE.md`: RED → GREEN → REFACTOR, one behavior per test, matching
  this package's existing suites' style and the mocked-`fetch` pattern in
  `abra-flexi-client.test.ts`.
- Conventional Commits, `git commit -s` (DCO sign-off) on every commit.
- Only touch files under `packages/invoicing-abraflexi/` and this plan doc —
  do not touch sub-project 2's (payment-sync) already-landed
  `createInvoice`/`recordPayment` methods or their tests except by pure
  addition (new methods, new describe blocks); never edit their existing
  bodies.
- Package test gate (`pnpm --filter @medusa-cz/invoicing-abraflexi test`,
  `typecheck`, `build`) must be green before Task 4 (subscriber wiring) is
  considered done — no new module registration is needed in
  `apps/backend/medusa-config.ts` (that's a different, private repo; Medusa
  auto-discovers subscribers by file location, same as `payment-captured.ts`).
- The DB-backed idempotency integration test (Task 5) needs a real reachable
  Postgres (`DB_HOST`/`DB_USERNAME`/`DB_PASSWORD`/`DB_PORT`, `pg-god`
  devDependency already present, the `localhost`-not-`127.0.0.1` SSL trap
  already documented in `create-invoice-idempotency.test.ts`'s header
  comment) — same requirements, not repeated per-task below.
- **Batching decision (implementation detail not fully spelled out by the
  spec):** the spec's §3 step 4 describes "per new refund: build payload,
  create, persist" as three sub-steps. Medusa's workflows-sdk has no
  construct for a step count determined by a runtime array length (the
  number of new refunds is only known once the list-refunds step has
  actually run) — you cannot `for`-loop over `WorkflowData` at workflow
  _definition_ time. This plan implements steps 4a/4b as **one step each**
  that loops internally over every new refund in a single call (build +
  create per refund inside the loop, since payload-building is synchronous
  and cheap), and step 4c as one step that appends every newly-created
  refund id in one batched, non-clobbering `updateOrders` call. This
  preserves every named guarantee (one independent credit note per refund,
  processed oldest-first, non-overwriting persistence) without inventing an
  unsupported orchestration mechanism. If a refund partway through the loop
  fails non-retryably, any credit notes already created for earlier refunds
  in that same call are **not** persisted to `abra_flexi_recorded_refund_ids`
  — same class of gap the spec already names in its "Open questions" §6.4,
  not a new one introduced here.
- **Query-graph field path — verified, not guessed, but not exercised
  against a live Postgres in this session:** `resolveOrderByIdStepFn` queries
  the `"order"` entity for `"payment_collections.payments.id"`. Confirmed
  against this repo's installed `@medusajs/types@2.17.0`:
  `dist/order/common.d.ts`'s `OrderDetailDTO.payment_collections:
PaymentCollectionDTO[]` and `dist/payment/common.d.ts`'s
  `PaymentCollectionDTO.payments?: PaymentDTO[]` are both real, declared
  fields — this is the direct-direction counterpart to
  `resolveOrderStepFn`'s existing reverse-direction
  `query.graph({ entity: "order_payment_collection", fields: ["order.*"] })`
  call. However, no Postgres was reachable in the session that wrote this
  plan, so this exact field path has only been typechecked, never run for
  real. Task 5's DB-backed test is what actually exercises it — if it fails
  with a "no such field/relation" error, fix the field path there (not by
  guessing further) before trusting it.
- `typDokl: "code:DOBROPIS"` (the Abra Flexi document-type code for a credit
  note) and the two-sequential-PUTs shape are this session's verified
  decisions per the research doc, not guesses — see spec §1 and research doc
  Part 1 for why, and Task 6 for the live-sandbox check neither Task 1-5 can
  perform.

---

## 1. File structure

```
packages/invoicing-abraflexi/
  README.md                                          # updated (Task 4)
  src/
    types.ts                                          # + AbraFlexiCreditNotePayload/Result, DOBROPIS code const (Task 1)
    index.ts                                           # + createCreditNoteInAbraFlexiWorkflow export (Task 3)
    core/
      abra-flexi-client.ts                             # + createCreditNote() (Task 1)
      __tests__/
        abra-flexi-client.test.ts                      # + createCreditNote tests (Task 1)
      order-to-invoice-mapper.ts                       # + creditNoteExternalCodeForRefund (Task 2)
      __tests__/
        order-to-invoice-mapper.test.ts                # + helper test (Task 2)
      order-to-credit-note-mapper.ts                    # new: mapOrderToFullCreditNote, mapRefundToLumpSumCreditNote (Task 2)
      __tests__/
        order-to-credit-note-mapper.test.ts             # new (Task 2)
    workflows/
      create-invoice-in-abra-flexi.ts                  # unchanged (resolveOrderStepFn reused, Task 4)
      create-credit-note-in-abra-flexi.ts               # new: workflow (Task 3)
      __tests__/
        create-credit-note-in-abra-flexi.test.ts        # new (Task 3)
    subscribers/
      payment-refunded.ts                               # new (Task 4)
      order-canceled.ts                                 # new (Task 4)
      __tests__/
        payment-refunded.test.ts                        # new (Task 4)
        order-canceled.test.ts                           # new (Task 4)
    __tests__/
      integration/
        idempotency/
          mock-abra-flexi-server.ts                    # extended: + credit-note create/link counters (Task 5)
          credit-note-idempotency.test.ts               # new (Task 5)
        abra-flexi-sandbox.test.ts                      # extended: live createCreditNote case (Task 6)
```

---

### Task 1: `AbraFlexiClient.createCreditNote`

**Files:**

- Modify: `packages/invoicing-abraflexi/src/types.ts`
- Modify: `packages/invoicing-abraflexi/src/core/abra-flexi-client.ts`
- Modify: `packages/invoicing-abraflexi/src/core/__tests__/abra-flexi-client.test.ts`

**Interfaces:**

- Consumes: none new (reuses `ABRA_FLEXI_VAT_RATE_CODE_BASIC`, `AbraFlexiApiError`, `AbraFlexiInvoicePayload`/`AbraFlexiCustomer`/`AbraFlexiInvoiceLine` shapes already in this file).
- Produces (used by Task 3): `AbraFlexiClient.createCreditNote(payload: AbraFlexiCreditNotePayload): Promise<AbraFlexiCreditNoteResult>`; types `AbraFlexiCreditNotePayload` (= `AbraFlexiInvoicePayload` + `originalInvoiceExternalCode`), `AbraFlexiCreditNoteResult { id, code }`; constant `ABRA_FLEXI_DOCUMENT_TYPE_CODE_CREDIT_NOTE`.

- [ ] **Step 1: Add the new types and constant**

Add to `packages/invoicing-abraflexi/src/types.ts`, after the existing `AbraFlexiRecordPaymentResult` interface:

```ts
export interface AbraFlexiCreditNotePayload extends AbraFlexiInvoicePayload {
  /**
   * externalCode of the original invoice this credit note corrects (the same
   * AbraFlexiInvoicePayload.externalCode / abraFlexiExternalCodeForOrder(orderId)
   * value createInvoice() already used for that invoice) -- sent as
   * vytvor-vazbu-dobropis.dobropisovanyDokl on the second (link) PUT.
   */
  originalInvoiceExternalCode: string
}

export interface AbraFlexiCreditNoteResult {
  id: string
  code: string
}
```

Add after the existing `ABRA_FLEXI_PAYMENT_STATUS_CODE_PAID_MANUALLY` constant:

```ts
// Abra Flexi's document-type code for a credit note (dobropis / opravný daňový
// doklad), written as `typDokl` on the same faktura-vydana.json endpoint
// createInvoice()/recordPayment() already use -- see
// docs/superpowers/research/2026-09-07-abra-flexi-credit-notes-api-verification.md
// Part 1. Not verified against a live instance whether this code exists by
// default in every Abra Flexi company (same caveat this package's README
// already carries for code:FAKTURA) -- confirm via
// pnpm --filter @medusa-cz/invoicing-abraflexi test:integration's live
// sandbox suite (Task 6) before relying on it in production.
export const ABRA_FLEXI_DOCUMENT_TYPE_CODE_CREDIT_NOTE = "DOBROPIS"
```

- [ ] **Step 2: Write the failing tests**

Add to `packages/invoicing-abraflexi/src/core/__tests__/abra-flexi-client.test.ts`. First, update the import lines at the top of the file:

```ts
import { AbraFlexiClient, AbraFlexiApiError } from "../abra-flexi-client"
import {
  ABRA_FLEXI_VAT_RATE_CODE_BASIC,
  ABRA_FLEXI_PAYMENT_STATUS_CODE_PAID_MANUALLY,
  ABRA_FLEXI_DOCUMENT_TYPE_CODE_CREDIT_NOTE,
} from "../../types"
import type { AbraFlexiInvoicePayload, AbraFlexiCreditNotePayload } from "../../types"
```

(replacing the existing `import { ABRA_FLEXI_VAT_RATE_CODE_BASIC, ABRA_FLEXI_PAYMENT_STATUS_CODE_PAID_MANUALLY } from "../../types"` and `import type { AbraFlexiInvoicePayload } from "../../types"` lines)

Then add this new `describe` block at the end of the file, after the closing `})` of `describe("AbraFlexiClient.recordPayment", ...)`:

```ts
describe("AbraFlexiClient.createCreditNote", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockFetchFn = null
  })

  const creditNotePayload: AbraFlexiCreditNotePayload = {
    externalCode: "order-ord_123-credit-ref_1",
    originalInvoiceExternalCode: "order-ord_123",
    currency: "CZK",
    issueDate: "2026-09-07",
    dueDate: "2026-09-21",
    customer: { name: "Jan Novák", countryCode: "CZ" },
    lines: [{ name: "Refund", quantity: -1, unitPrice: 100 }],
    vatPayer: false,
  }

  it("PUTs twice to the same faktura-vydana collection URL: create, then link", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "555" }] } })
    mockFetchOnce(200, { winstrom: { success: true, results: [{ id: "555" }] } })
    await new AbraFlexiClient(opts).createCreditNote(creditNotePayload)
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0]![0]).toBe("https://demo.flexibee.eu:5434/c/demo_company/faktura-vydana.json")
    expect(calls[0]![1].method).toBe("PUT")
    expect(calls[1]![0]).toBe("https://demo.flexibee.eu:5434/c/demo_company/faktura-vydana.json")
    expect(calls[1]![1].method).toBe("PUT")
  })

  it("sends typDokl DOBROPIS, the record's own code, and its own line items on the first PUT", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "555" }] } })
    mockFetchOnce(200, { winstrom: { success: true, results: [{ id: "555" }] } })
    await new AbraFlexiClient(opts).createCreditNote(creditNotePayload)
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    const record = JSON.parse(calls[0]![1].body).winstrom["faktura-vydana"]
    expect(record.id).toBe("code:order-ord_123-credit-ref_1")
    expect(record.typDokl).toBe(`code:${ABRA_FLEXI_DOCUMENT_TYPE_CODE_CREDIT_NOTE}`)
    expect(record.mena).toBe("code:CZK")
    expect(record.polozkyFaktury[0]["faktura-vydana-polozka"]).toEqual({
      nazev: "Refund",
      mnozMj: -1,
      cenaMj: 100,
    })
  })

  it("sends only the link field, addressing the credit note's own code, on the second PUT", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "555" }] } })
    mockFetchOnce(200, { winstrom: { success: true, results: [{ id: "555" }] } })
    await new AbraFlexiClient(opts).createCreditNote(creditNotePayload)
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    const secondBody = JSON.parse(calls[1]![1].body)
    expect(secondBody.winstrom["faktura-vydana"]).toEqual({
      id: "code:order-ord_123-credit-ref_1",
      "vytvor-vazbu-dobropis": { dobropisovanyDokl: "code:order-ord_123" },
    })
  })

  it("resolves with the created credit note's numeric id and its own external code", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "555" }] } })
    mockFetchOnce(200, { winstrom: { success: true, results: [{ id: "555" }] } })
    const result = await new AbraFlexiClient(opts).createCreditNote(creditNotePayload)
    expect(result).toEqual({ id: "555", code: "order-ord_123-credit-ref_1" })
  })

  it("does not attempt the link PUT when the create PUT fails, and throws its error as-is", async () => {
    mockFetchOnce(400, {
      winstrom: { success: false, results: [{ id: "0", errors: [{ message: "bad payload" }] }] },
    })
    await expect(
      new AbraFlexiClient(opts).createCreditNote(creditNotePayload)
    ).rejects.toMatchObject({
      name: "AbraFlexiApiError",
      status: 400,
      retryable: false,
      message: "bad payload",
    })
    expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
  })

  it("treats a 5xx on the create PUT as retryable", async () => {
    mockFetchOnce(500, {
      winstrom: { success: false, results: [{ id: "0", errors: [{ message: "boom" }] }] },
    })
    await expect(
      new AbraFlexiClient(opts).createCreditNote(creditNotePayload)
    ).rejects.toMatchObject({ name: "AbraFlexiApiError", status: 500, retryable: true })
  })

  it("wraps a non-retryable link-PUT failure with an 'orphaned credit note' message, preserving its status", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "555" }] } })
    mockFetchOnce(400, {
      winstrom: {
        success: false,
        results: [{ id: "0", errors: [{ message: "already linked to another document" }] }],
      },
    })
    await expect(
      new AbraFlexiClient(opts).createCreditNote(creditNotePayload)
    ).rejects.toMatchObject({
      name: "AbraFlexiApiError",
      status: 400,
      retryable: false,
      message: expect.stringContaining(
        'credit note "order-ord_123-credit-ref_1" (id "555") was created but linking it to invoice "order-ord_123" failed: already linked to another document'
      ),
    })
  })

  it("wraps a retryable (5xx) link-PUT failure the same way, preserving retryable: true", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "555" }] } })
    mockFetchOnce(500, {
      winstrom: { success: false, results: [{ id: "0", errors: [{ message: "boom" }] }] },
    })
    await expect(
      new AbraFlexiClient(opts).createCreditNote(creditNotePayload)
    ).rejects.toMatchObject({ name: "AbraFlexiApiError", status: 500, retryable: true })
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test -- abra-flexi-client`
Expected: FAIL — `client.createCreditNote is not a function`.

- [ ] **Step 4: Implement `createCreditNote`**

Add to `packages/invoicing-abraflexi/src/core/abra-flexi-client.ts`. First, update the top import lines:

```ts
import type {
  AbraFlexiInvoicePayload,
  AbraFlexiInvoiceResult,
  AbraFlexiOptions,
  AbraFlexiRecordPaymentPayload,
  AbraFlexiRecordPaymentResult,
  AbraFlexiCreditNotePayload,
  AbraFlexiCreditNoteResult,
} from "../types.js"
import {
  ABRA_FLEXI_VAT_RATE_CODE_BASIC,
  ABRA_FLEXI_PAYMENT_STATUS_CODE_PAID_MANUALLY,
  ABRA_FLEXI_DOCUMENT_TYPE_CODE_CREDIT_NOTE,
} from "../types.js"
```

(replacing the existing two `import` lines at the top of the file)

Then add these to the `AbraFlexiClient` class, after `recordPayment`:

```ts
  // Shared by createCreditNote's two sequential PUTs (create, then link) below
  // -- NOT used by createInvoice/recordPayment above, which predate this
  // helper and are left untouched (same fetch/parse/error shape, just not
  // re-plumbed through this method, to avoid touching already-shipped
  // sub-project 2 code for a sub-project 3 change).
  private async putFakturaVydana(record: Record<string, unknown>): Promise<{ id: string }> {
    let res: Response
    try {
      res = await this.fetchFn(`${this.base}/c/${this.company}/faktura-vydana.json`, {
        method: "PUT",
        headers: { Authorization: this.auth, "Content-Type": "application/json" },
        body: JSON.stringify({ winstrom: { "faktura-vydana": record } }),
      })
    } catch (e) {
      throw new AbraFlexiApiError(0, `Abra Flexi network error: ${(e as Error).message}`, true)
    }

    let parsed: AbraFlexiWriteResponse | undefined
    try {
      parsed = (await res.json()) as AbraFlexiWriteResponse
    } catch {
      parsed = undefined
    }

    const result = parsed?.winstrom?.results?.[0]
    const retryable = res.status >= 500
    if (!res.ok || parsed?.winstrom?.success === false) {
      const message = result?.errors?.[0]?.message ?? `Abra Flexi HTTP ${res.status}`
      throw new AbraFlexiApiError(res.status, message, retryable)
    }
    if (!result?.id) {
      throw new AbraFlexiApiError(res.status, "Abra Flexi: write response missing result id", false)
    }
    return { id: String(result.id) }
  }

  async createCreditNote(payload: AbraFlexiCreditNotePayload): Promise<AbraFlexiCreditNoteResult> {
    const creditNote: Record<string, unknown> = {
      id: `code:${payload.externalCode}`,
      typDokl: `code:${ABRA_FLEXI_DOCUMENT_TYPE_CODE_CREDIT_NOTE}`,
      datVyd: payload.issueDate,
      splatnost: payload.dueDate,
      mena: `code:${payload.currency}`,
      nazFirma: payload.customer.name,
    }
    if (payload.customer.street) creditNote.ulice = payload.customer.street
    if (payload.customer.city) creditNote.mesto = payload.customer.city
    if (payload.customer.postalCode) creditNote.psc = payload.customer.postalCode
    if (payload.customer.countryCode) creditNote.stat = `code:${payload.customer.countryCode}`
    if (payload.customer.ico) creditNote.ic = payload.customer.ico
    if (payload.customer.dic) creditNote.dic = payload.customer.dic

    creditNote.polozkyFaktury = payload.lines.map((line) => ({
      "faktura-vydana-polozka": {
        nazev: line.name,
        mnozMj: line.quantity,
        cenaMj: line.unitPrice,
        ...(line.vatRate != null
          ? { typCenyDphK: "typCeny.bezDph", typSzbDphK: ABRA_FLEXI_VAT_RATE_CODE_BASIC }
          : {}),
      },
    }))

    // PUT #1: create the credit note with its own line items. A failure here
    // means nothing was created in Abra Flexi -- the ordinary retryable/
    // permanent error shape, same as createInvoice.
    const created = await this.putFakturaVydana(creditNote)

    // PUT #2: link it to the original invoice by code. A failure here means
    // the credit note document *does* now exist in Abra Flexi, just unlinked
    // -- the error message says so explicitly (see spec's "orphaned dobropis"
    // note), since that's a materially different, worse failure mode than
    // "never created" and this package doesn't attempt to auto-delete or
    // auto-retry-link it.
    try {
      await this.putFakturaVydana({
        id: `code:${payload.externalCode}`,
        "vytvor-vazbu-dobropis": {
          dobropisovanyDokl: `code:${payload.originalInvoiceExternalCode}`,
        },
      })
    } catch (e) {
      if (e instanceof AbraFlexiApiError) {
        throw new AbraFlexiApiError(
          e.status,
          `Abra Flexi: credit note "${payload.externalCode}" (id "${created.id}") was created but linking it to invoice "${payload.originalInvoiceExternalCode}" failed: ${e.message}`,
          e.retryable
        )
      }
      throw e
    }

    return { id: created.id, code: payload.externalCode }
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test -- abra-flexi-client`
Expected: PASS, all three describe blocks (`createInvoice`, `recordPayment`, `createCreditNote`).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/invoicing-abraflexi/src/types.ts packages/invoicing-abraflexi/src/core/abra-flexi-client.ts packages/invoicing-abraflexi/src/core/__tests__/abra-flexi-client.test.ts
git commit -s -m "feat(invoicing-abraflexi): add AbraFlexiClient.createCreditNote

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015GVXnUEPzksefqEG62mekN"
```

---

### Task 2: Credit-note mapping functions

**Files:**

- Modify: `packages/invoicing-abraflexi/src/core/order-to-invoice-mapper.ts`
- Modify: `packages/invoicing-abraflexi/src/core/__tests__/order-to-invoice-mapper.test.ts`
- Create: `packages/invoicing-abraflexi/src/core/order-to-credit-note-mapper.ts`
- Create: `packages/invoicing-abraflexi/src/core/__tests__/order-to-credit-note-mapper.test.ts`

**Interfaces:**

- Consumes: `mapOrderToAbraFlexiInvoice`, `AbraFlexiMapperConfig` (existing, from `order-to-invoice-mapper.ts`); `CZ_VAT_RATE_BASIC` (existing, from `types.ts`).
- Produces (used by Task 3): `creditNoteExternalCodeForRefund(orderId: string, refundId: string): string`, exported from `order-to-invoice-mapper.ts`; `mapOrderToFullCreditNote(order, config, refundId): AbraFlexiInvoicePayload` and `mapRefundToLumpSumCreditNote(order, config, refund): AbraFlexiInvoicePayload`, both exported from the new `order-to-credit-note-mapper.ts`; type `AbraFlexiRefundForCreditNote { id, amount, note? }`.

`creditNoteExternalCodeForRefund` lives alongside `abraFlexiExternalCodeForOrder`
in the same file (spec's own framing: "a new helper alongside
`abraFlexiExternalCodeForOrder`"). The two credit-note payload builders get
their own sibling file rather than growing `order-to-invoice-mapper.ts`
further — a distinct mapping concern (credit notes, not invoices), matching
this package's one-file-per-concern layout for workflows/subscribers.

- [ ] **Step 1: Write the failing test for the externalCode helper**

Add to `packages/invoicing-abraflexi/src/core/__tests__/order-to-invoice-mapper.test.ts`, updating the import line at the top:

```ts
import {
  mapOrderToAbraFlexiInvoice,
  abraFlexiExternalCodeForOrder,
  creditNoteExternalCodeForRefund,
} from "../order-to-invoice-mapper"
```

(replacing the existing import line)

Add this new `describe` block at the end of the file, after the closing `})` of `describe("abraFlexiExternalCodeForOrder", ...)`:

```ts
describe("creditNoteExternalCodeForRefund", () => {
  it("combines the order id and refund id into a single deterministic code", () => {
    expect(creditNoteExternalCodeForRefund("ord_123", "ref_1")).toBe("order-ord_123-credit-ref_1")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test -- order-to-invoice-mapper`
Expected: FAIL — `creditNoteExternalCodeForRefund` is not exported from `../order-to-invoice-mapper`.

- [ ] **Step 3: Implement the helper**

Add to `packages/invoicing-abraflexi/src/core/order-to-invoice-mapper.ts`, directly after `abraFlexiExternalCodeForOrder`:

```ts
export function creditNoteExternalCodeForRefund(orderId: string, refundId: string): string {
  return `order-${orderId}-credit-${refundId}`
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test -- order-to-invoice-mapper`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for the two credit-note mapping functions**

Create `packages/invoicing-abraflexi/src/core/__tests__/order-to-credit-note-mapper.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  mapOrderToFullCreditNote,
  mapRefundToLumpSumCreditNote,
} from "../order-to-credit-note-mapper"
import { CZ_VAT_RATE_BASIC } from "../../types"
import type { OrderDTO } from "@medusajs/framework/types"

function baseOrder(overrides: Partial<OrderDTO> = {}): OrderDTO {
  return {
    id: "ord_123",
    email: "customer@example.com",
    currency_code: "czk",
    metadata: null,
    billing_address: {
      id: "addr_1",
      first_name: "Jan",
      last_name: "Novák",
      address_1: "Hlavní 1",
      city: "Praha",
      postal_code: "11000",
      country_code: "cz",
      created_at: new Date(),
      updated_at: new Date(),
    },
    items: [
      { id: "li_1", title: "Tričko", quantity: 2, unit_price: 299 },
      { id: "li_2", title: "Doprava", quantity: 1, unit_price: 79 },
    ],
    ...overrides,
  } as OrderDTO
}

describe("mapOrderToFullCreditNote", () => {
  it("negates every item line's quantity, keeping name/unitPrice unchanged", () => {
    const payload = mapOrderToFullCreditNote(baseOrder(), { vatPayer: false }, "ref_1")
    expect(payload.lines).toEqual([
      { name: "Tričko", quantity: -2, unitPrice: 299, vatRate: undefined },
      { name: "Doprava", quantity: -1, unitPrice: 79, vatRate: undefined },
    ])
  })

  it("negates shipping lines too", () => {
    const order = baseOrder({
      shipping_methods: [{ name: "Poštovné", amount: 79 }] as OrderDTO["shipping_methods"],
    })
    const payload = mapOrderToFullCreditNote(order, { vatPayer: false }, "ref_1")
    expect(payload.lines[2]).toEqual({
      name: "Poštovné",
      quantity: -1,
      unitPrice: 79,
      vatRate: undefined,
    })
  })

  it("sets the credit-note external code from the order id and refund id", () => {
    const payload = mapOrderToFullCreditNote(baseOrder(), { vatPayer: false }, "ref_1")
    expect(payload.externalCode).toBe("order-ord_123-credit-ref_1")
  })

  it("keeps the vatPayer gating identical to mapOrderToAbraFlexiInvoice", () => {
    const payload = mapOrderToFullCreditNote(baseOrder(), { vatPayer: true }, "ref_1")
    expect(payload.lines.every((l) => l.vatRate === CZ_VAT_RATE_BASIC)).toBe(true)
    expect(payload.vatPayer).toBe(true)
  })

  it("reuses the same customer/currency mapping as the original invoice", () => {
    const payload = mapOrderToFullCreditNote(baseOrder(), { vatPayer: false }, "ref_1")
    expect(payload.currency).toBe("CZK")
    expect(payload.customer).toMatchObject({ name: "Jan Novák", city: "Praha" })
  })
})

describe("mapRefundToLumpSumCreditNote", () => {
  it("produces a single line with quantity -1 and unitPrice equal to the refund amount", () => {
    const payload = mapRefundToLumpSumCreditNote(
      baseOrder(),
      { vatPayer: false },
      {
        id: "ref_1",
        amount: 150,
      }
    )
    expect(payload.lines).toEqual([
      { name: "Refund", quantity: -1, unitPrice: 150, vatRate: undefined },
    ])
  })

  it("incorporates the refund's note into the line name when present", () => {
    const payload = mapRefundToLumpSumCreditNote(
      baseOrder(),
      { vatPayer: false },
      {
        id: "ref_1",
        amount: 150,
        note: "Damaged item",
      }
    )
    expect(payload.lines[0]!.name).toBe("Refund: Damaged item")
  })

  it("sets the credit-note external code from the order id and refund id", () => {
    const payload = mapRefundToLumpSumCreditNote(
      baseOrder(),
      { vatPayer: false },
      {
        id: "ref_1",
        amount: 150,
      }
    )
    expect(payload.externalCode).toBe("order-ord_123-credit-ref_1")
  })

  it("applies the basic VAT rate to the lump-sum line when vatPayer is true", () => {
    const payload = mapRefundToLumpSumCreditNote(
      baseOrder(),
      { vatPayer: true },
      {
        id: "ref_1",
        amount: 150,
      }
    )
    expect(payload.lines[0]!.vatRate).toBe(CZ_VAT_RATE_BASIC)
  })

  it("reuses the same customer/currency mapping as the original invoice", () => {
    const payload = mapRefundToLumpSumCreditNote(
      baseOrder(),
      { vatPayer: false },
      {
        id: "ref_1",
        amount: 150,
      }
    )
    expect(payload.currency).toBe("CZK")
    expect(payload.customer).toMatchObject({ name: "Jan Novák" })
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test -- order-to-credit-note-mapper`
Expected: FAIL — `../order-to-credit-note-mapper` module does not exist.

- [ ] **Step 7: Implement the two mapping functions**

Create `packages/invoicing-abraflexi/src/core/order-to-credit-note-mapper.ts`:

```ts
import type { OrderDTO } from "@medusajs/framework/types"
import { CZ_VAT_RATE_BASIC } from "../types.js"
import type { AbraFlexiInvoicePayload } from "../types.js"
import {
  mapOrderToAbraFlexiInvoice,
  creditNoteExternalCodeForRefund,
  type AbraFlexiMapperConfig,
} from "./order-to-invoice-mapper.js"

export interface AbraFlexiRefundForCreditNote {
  id: string
  /** major units -- the caller converts RefundDTO's BigNumberValue with Number(...) first */
  amount: number
  note?: string | null
}

// Order-cancellation path: mirror the original invoice's own item + shipping
// lines, negated -- a full, honest storno of everything originally billed.
// Reuses mapOrderToAbraFlexiInvoice's line/customer/currency/date construction
// wholesale rather than duplicating it, then only negates quantities and swaps
// in the credit note's own externalCode.
export function mapOrderToFullCreditNote(
  order: OrderDTO,
  config: AbraFlexiMapperConfig,
  refundId: string
): AbraFlexiInvoicePayload {
  const invoice = mapOrderToAbraFlexiInvoice(order, config)
  return {
    ...invoice,
    externalCode: creditNoteExternalCodeForRefund(order.id, refundId),
    lines: invoice.lines.map((line) => ({ ...line, quantity: -line.quantity })),
  }
}

// Explicit payment-refund path: RefundDTO carries only a total amount, no
// order-line breakdown (verified in
// docs/superpowers/research/2026-09-07-abra-flexi-credit-notes-api-verification.md
// Part 2) -- so this is a single generic lump-sum line, not a guess at which
// order line was returned. Same vatPayer gating as regular invoice lines.
export function mapRefundToLumpSumCreditNote(
  order: OrderDTO,
  config: AbraFlexiMapperConfig,
  refund: AbraFlexiRefundForCreditNote
): AbraFlexiInvoicePayload {
  const invoice = mapOrderToAbraFlexiInvoice(order, config)
  const lineName = refund.note ? `Refund: ${refund.note}` : "Refund"
  return {
    ...invoice,
    externalCode: creditNoteExternalCodeForRefund(order.id, refund.id),
    lines: [
      {
        name: lineName,
        quantity: -1,
        unitPrice: refund.amount,
        vatRate: config.vatPayer ? CZ_VAT_RATE_BASIC : undefined,
      },
    ],
  }
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test -- order-to-credit-note-mapper order-to-invoice-mapper`
Expected: PASS, both files.

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/invoicing-abraflexi/src/core/order-to-invoice-mapper.ts packages/invoicing-abraflexi/src/core/__tests__/order-to-invoice-mapper.test.ts packages/invoicing-abraflexi/src/core/order-to-credit-note-mapper.ts packages/invoicing-abraflexi/src/core/__tests__/order-to-credit-note-mapper.test.ts
git commit -s -m "feat(invoicing-abraflexi): add credit-note mapping functions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015GVXnUEPzksefqEG62mekN"
```

---

### Task 3: `createCreditNoteInAbraFlexiWorkflow`

**Files:**

- Create: `packages/invoicing-abraflexi/src/workflows/create-credit-note-in-abra-flexi.ts`
- Create: `packages/invoicing-abraflexi/src/workflows/__tests__/create-credit-note-in-abra-flexi.test.ts`
- Modify: `packages/invoicing-abraflexi/src/index.ts`

**Interfaces:**

- Consumes: `AbraFlexiClient.createCreditNote` (Task 1); `mapOrderToFullCreditNote`/`mapRefundToLumpSumCreditNote` (Task 2); `AbraFlexiApiError` (existing); `ABRA_FLEXI_MODULE` (existing).
- Produces (used by Task 4): `createCreditNoteInAbraFlexiWorkflow(container)` — a Medusa workflow, `.run({ input: { orderId: string, triggeredBy: "order_canceled" | "payment_refunded" } })`, resolving to `{ recordedRefundIds: string[] }`. Also exports `resolveOrderByIdStepFn`, `listNewRefundsStepFn`, `createCreditNotesForNewRefundsStepFn`, `persistRecordedRefundIdsStepFn` (unit-tested directly, same pattern as the other two workflows' exported step functions), and the `CreditNoteTrigger`/`CreateCreditNoteInAbraFlexiInput` types.

- [ ] **Step 1: Write the failing unit tests**

Create `packages/invoicing-abraflexi/src/workflows/__tests__/create-credit-note-in-abra-flexi.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import {
  resolveOrderByIdStepFn,
  listNewRefundsStepFn,
  createCreditNotesForNewRefundsStepFn,
  persistRecordedRefundIdsStepFn,
} from "../create-credit-note-in-abra-flexi"
import { AbraFlexiApiError } from "../../core/abra-flexi-client"
import type { OrderDTO, RefundDTO } from "@medusajs/framework/types"

const order = {
  id: "ord_1",
  email: "c@example.com",
  currency_code: "czk",
  metadata: { abra_flexi_invoice_id: "42", abra_flexi_invoice_code: "order-ord_1" },
  billing_address: { first_name: "Jan", last_name: "Novák" },
  items: [{ id: "li_1", title: "Tričko", quantity: 1, unit_price: 100 }],
} as unknown as OrderDTO

function mockContainer(overrides: Record<string, unknown> = {}) {
  return { resolve: vi.fn((key: string) => overrides[key]) }
}

function refund(overrides: Partial<RefundDTO> = {}): RefundDTO {
  return {
    id: "ref_1",
    amount: 100,
    created_at: new Date("2026-09-01"),
    note: null,
    ...overrides,
  } as unknown as RefundDTO
}

describe("resolveOrderByIdStepFn", () => {
  it("resolves the order and flattens payment ids across every payment collection", async () => {
    const query = {
      graph: vi.fn().mockResolvedValue({
        data: [
          {
            ...order,
            payment_collections: [{ payments: [{ id: "pay_1" }, { id: "pay_2" }] }],
          },
        ],
      }),
    }
    const container = mockContainer({ query })

    const response = await resolveOrderByIdStepFn(
      { orderId: "ord_1", triggeredBy: "order_canceled" },
      { container } as never
    )

    expect(query.graph).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "order", filters: { id: "ord_1" } })
    )
    expect(response.output.paymentIds).toEqual(["pay_1", "pay_2"])
  })

  it("throws when no order is found for the id", async () => {
    const query = { graph: vi.fn().mockResolvedValue({ data: [] }) }
    const container = mockContainer({ query })

    await expect(
      resolveOrderByIdStepFn({ orderId: "ord_missing", triggeredBy: "order_canceled" }, {
        container,
      } as never)
    ).rejects.toThrow(/no order found/)
  })

  it("returns an empty payment id list when the order has no payment collections", async () => {
    const query = {
      graph: vi.fn().mockResolvedValue({ data: [{ ...order, payment_collections: [] }] }),
    }
    const container = mockContainer({ query })

    const response = await resolveOrderByIdStepFn(
      { orderId: "ord_1", triggeredBy: "order_canceled" },
      { container } as never
    )

    expect(response.output.paymentIds).toEqual([])
  })
})

describe("listNewRefundsStepFn", () => {
  it("returns an empty array without calling listRefunds when there are no payment ids", async () => {
    const listRefunds = vi.fn()
    const container = mockContainer({ payment: { listRefunds } })

    const response = await listNewRefundsStepFn({ paymentIds: [], recordedRefundIds: [] }, {
      container,
    } as never)

    expect(listRefunds).not.toHaveBeenCalled()
    expect(response.output).toEqual([])
  })

  it("filters out refund ids already recorded", async () => {
    const listRefunds = vi
      .fn()
      .mockResolvedValue([refund({ id: "ref_1" }), refund({ id: "ref_2" })])
    const container = mockContainer({ payment: { listRefunds } })

    const response = await listNewRefundsStepFn(
      { paymentIds: ["pay_1"], recordedRefundIds: ["ref_1"] },
      { container } as never
    )

    expect(response.output.map((r) => r.id)).toEqual(["ref_2"])
  })

  it("sorts remaining refunds oldest-first", async () => {
    const listRefunds = vi
      .fn()
      .mockResolvedValue([
        refund({ id: "ref_new", created_at: new Date("2026-09-05") }),
        refund({ id: "ref_old", created_at: new Date("2026-09-01") }),
      ])
    const container = mockContainer({ payment: { listRefunds } })

    const response = await listNewRefundsStepFn({ paymentIds: ["pay_1"], recordedRefundIds: [] }, {
      container,
    } as never)

    expect(response.output.map((r) => r.id)).toEqual(["ref_old", "ref_new"])
  })
})

describe("createCreditNotesForNewRefundsStepFn", () => {
  it("does nothing and calls no API when there are no new refunds", async () => {
    const createCreditNote = vi.fn()
    const container = mockContainer({
      abraFlexi: { getClient: () => ({ createCreditNote }), getOptions: () => ({}) },
    })

    const response = await createCreditNotesForNewRefundsStepFn(
      { order, newRefunds: [], triggeredBy: "order_canceled", invoiceExternalCode: "order-ord_1" },
      { container } as never
    )

    expect(createCreditNote).not.toHaveBeenCalled()
    expect(response.output).toEqual([])
  })

  it("builds a full-mirror payload for triggeredBy: order_canceled", async () => {
    const createCreditNote = vi
      .fn()
      .mockResolvedValue({ id: "1", code: "order-ord_1-credit-ref_1" })
    const container = mockContainer({
      abraFlexi: {
        getClient: () => ({ createCreditNote }),
        getOptions: () => ({ vatPayer: false }),
      },
    })

    await createCreditNotesForNewRefundsStepFn(
      {
        order,
        newRefunds: [refund({ id: "ref_1" })],
        triggeredBy: "order_canceled",
        invoiceExternalCode: "order-ord_1",
      },
      { container } as never
    )

    const sentPayload = createCreditNote.mock.calls[0]![0]
    expect(sentPayload.lines).toEqual([
      { name: "Tričko", quantity: -1, unitPrice: 100, vatRate: undefined },
    ])
    expect(sentPayload.originalInvoiceExternalCode).toBe("order-ord_1")
  })

  it("builds a lump-sum payload for triggeredBy: payment_refunded", async () => {
    const createCreditNote = vi
      .fn()
      .mockResolvedValue({ id: "1", code: "order-ord_1-credit-ref_1" })
    const container = mockContainer({
      abraFlexi: {
        getClient: () => ({ createCreditNote }),
        getOptions: () => ({ vatPayer: false }),
      },
    })

    await createCreditNotesForNewRefundsStepFn(
      {
        order,
        newRefunds: [refund({ id: "ref_1", amount: 250 })],
        triggeredBy: "payment_refunded",
        invoiceExternalCode: "order-ord_1",
      },
      { container } as never
    )

    const sentPayload = createCreditNote.mock.calls[0]![0]
    expect(sentPayload.lines).toEqual([
      { name: "Refund", quantity: -1, unitPrice: 250, vatRate: undefined },
    ])
  })

  it("creates one credit note per new refund, in the given order", async () => {
    const createCreditNote = vi
      .fn()
      .mockResolvedValueOnce({ id: "1", code: "order-ord_1-credit-ref_1" })
      .mockResolvedValueOnce({ id: "2", code: "order-ord_1-credit-ref_2" })
    const container = mockContainer({
      abraFlexi: {
        getClient: () => ({ createCreditNote }),
        getOptions: () => ({ vatPayer: false }),
      },
    })

    const response = await createCreditNotesForNewRefundsStepFn(
      {
        order,
        newRefunds: [refund({ id: "ref_1" }), refund({ id: "ref_2" })],
        triggeredBy: "payment_refunded",
        invoiceExternalCode: "order-ord_1",
      },
      { container } as never
    )

    expect(createCreditNote).toHaveBeenCalledTimes(2)
    expect(response.output).toEqual([
      { refundId: "ref_1", creditNoteId: "1", creditNoteCode: "order-ord_1-credit-ref_1" },
      { refundId: "ref_2", creditNoteId: "2", creditNoteCode: "order-ord_1-credit-ref_2" },
    ])
  })

  it("rethrows a retryable AbraFlexiApiError so the workflow engine retries", async () => {
    const createCreditNote = vi.fn().mockRejectedValue(new AbraFlexiApiError(500, "boom", true))
    const container = mockContainer({
      abraFlexi: {
        getClient: () => ({ createCreditNote }),
        getOptions: () => ({ vatPayer: false }),
      },
    })

    await expect(
      createCreditNotesForNewRefundsStepFn(
        {
          order,
          newRefunds: [refund({ id: "ref_1" })],
          triggeredBy: "payment_refunded",
          invoiceExternalCode: "order-ord_1",
        },
        { container } as never
      )
    ).rejects.toMatchObject({ name: "AbraFlexiApiError", retryable: true })
  })

  it("converts a non-retryable AbraFlexiApiError into a permanent step failure", async () => {
    const createCreditNote = vi
      .fn()
      .mockRejectedValue(new AbraFlexiApiError(400, "bad code", false))
    const container = mockContainer({
      abraFlexi: {
        getClient: () => ({ createCreditNote }),
        getOptions: () => ({ vatPayer: false }),
      },
    })

    await expect(
      createCreditNotesForNewRefundsStepFn(
        {
          order,
          newRefunds: [refund({ id: "ref_1" })],
          triggeredBy: "payment_refunded",
          invoiceExternalCode: "order-ord_1",
        },
        { container } as never
      )
    ).rejects.toMatchObject({
      // Medusa's PermanentStepFailureError sets its own .name to "PermanentStepFailure"
      // (no "Error" suffix) -- same as the other two workflows' equivalent cases.
      name: "PermanentStepFailure",
    })
  })
})

describe("persistRecordedRefundIdsStepFn", () => {
  it("does nothing and returns the existing list unchanged when there are no new refund ids", async () => {
    const updateOrders = vi.fn()
    const container = mockContainer({ order: { updateOrders } })
    const orderWithExisting = {
      ...order,
      metadata: { abra_flexi_recorded_refund_ids: ["ref_0"] },
    } as OrderDTO

    const response = await persistRecordedRefundIdsStepFn(
      { order: orderWithExisting, newRefundIds: [] },
      { container } as never
    )

    expect(updateOrders).not.toHaveBeenCalled()
    expect(response.output).toEqual(["ref_0"])
  })

  it("appends new refund ids to an empty list", async () => {
    const updateOrders = vi.fn().mockResolvedValue({})
    const container = mockContainer({ order: { updateOrders } })

    const response = await persistRecordedRefundIdsStepFn({ order, newRefundIds: ["ref_1"] }, {
      container,
    } as never)

    expect(updateOrders).toHaveBeenCalledWith("ord_1", {
      metadata: { ...order.metadata, abra_flexi_recorded_refund_ids: ["ref_1"] },
    })
    expect(response.output).toEqual(["ref_1"])
  })

  it("appends without dropping prior entries (a second, later refund on the same order)", async () => {
    const updateOrders = vi.fn().mockResolvedValue({})
    const container = mockContainer({ order: { updateOrders } })
    const orderWithExisting = {
      ...order,
      metadata: { abra_flexi_recorded_refund_ids: ["ref_1"] },
    } as OrderDTO

    const response = await persistRecordedRefundIdsStepFn(
      { order: orderWithExisting, newRefundIds: ["ref_2"] },
      { container } as never
    )

    expect(updateOrders).toHaveBeenCalledWith("ord_1", {
      metadata: { abra_flexi_recorded_refund_ids: ["ref_1", "ref_2"] },
    })
    expect(response.output).toEqual(["ref_1", "ref_2"])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test -- create-credit-note-in-abra-flexi`
Expected: FAIL — `../create-credit-note-in-abra-flexi` module does not exist.

- [ ] **Step 3: Implement the workflow**

Create `packages/invoicing-abraflexi/src/workflows/create-credit-note-in-abra-flexi.ts`:

```ts
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  when,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework"
import type { OrderDTO, RefundDTO } from "@medusajs/framework/types"
import { ABRA_FLEXI_MODULE } from "../modules/abra-flexi/index.js"
import type AbraFlexiModuleService from "../modules/abra-flexi/service.js"
import { AbraFlexiApiError } from "../core/abra-flexi-client.js"
import {
  mapOrderToFullCreditNote,
  mapRefundToLumpSumCreditNote,
} from "../core/order-to-credit-note-mapper.js"

export type CreditNoteTrigger = "order_canceled" | "payment_refunded"

export interface CreateCreditNoteInAbraFlexiInput {
  orderId: string
  triggeredBy: CreditNoteTrigger
}

interface StepCtx {
  container: MedusaContainer
}

export interface ResolvedOrderForCreditNote {
  order: OrderDTO
  paymentIds: string[]
}

// Resolves directly by order id (both trigger paths arrive here already
// holding one -- payment-refunded.ts resolves its payment id to an order id
// first via create-invoice-in-abra-flexi.ts's resolveOrderStepFn,
// order-canceled.ts's event payload already is one). Queries the "order"
// entity itself for "payment_collections.payments.id" -- verified against
// this repo's installed @medusajs/types@2.17.0 (OrderDetailDTO.payment_collections:
// PaymentCollectionDTO[] in dist/order/common.d.ts, PaymentCollectionDTO.payments?:
// PaymentDTO[] in dist/payment/common.d.ts) as a real, queryable field path --
// the direct-direction counterpart to resolveOrderStepFn's existing reverse
// "order_payment_collection" join.
export async function resolveOrderByIdStepFn(
  input: CreateCreditNoteInAbraFlexiInput,
  { container }: StepCtx
): Promise<StepResponse<ResolvedOrderForCreditNote>> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "email",
      "currency_code",
      "metadata",
      "items.title",
      "items.quantity",
      "items.unit_price",
      "shipping_methods.name",
      "shipping_methods.amount",
      "shipping_address.*",
      "billing_address.*",
      "payment_collections.payments.id",
    ],
    filters: { id: input.orderId },
  })

  const order = data[0] as
    | (OrderDTO & { payment_collections?: { payments?: { id: string }[] | null }[] | null })
    | undefined
  if (!order) {
    throw new Error(`Abra Flexi: no order found for order id "${input.orderId}"`)
  }

  const paymentIds = (order.payment_collections ?? [])
    .flatMap((pc) => pc?.payments ?? [])
    .map((p) => p.id)

  return new StepResponse({ order, paymentIds })
}
const resolveOrderByIdStep = createStep(
  "resolve-order-by-id-for-credit-note",
  resolveOrderByIdStepFn
)

export async function listNewRefundsStepFn(
  input: { paymentIds: string[]; recordedRefundIds: string[] },
  { container }: StepCtx
): Promise<StepResponse<RefundDTO[]>> {
  if (input.paymentIds.length === 0) {
    return new StepResponse([])
  }
  const paymentModuleService = container.resolve(Modules.PAYMENT)
  const refunds = await paymentModuleService.listRefunds(
    { payment_id: input.paymentIds },
    // Default page size is 15 (@medusajs/types' listRefunds doc comment) --
    // generous explicit `take` so an order with many refunds over its
    // lifetime doesn't silently truncate which ones this step sees.
    { take: 1000 }
  )
  const sorted = [...refunds].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )
  return new StepResponse(sorted.filter((r) => !input.recordedRefundIds.includes(r.id)))
}
const listNewRefundsStep = createStep("list-new-refunds-for-credit-note", listNewRefundsStepFn)

export interface CreatedCreditNote {
  refundId: string
  creditNoteId: string
  creditNoteCode: string
}

// Loops internally over every new refund rather than one workflow step per
// refund -- Medusa's workflows-sdk has no construct for a step count
// determined by runtime array length (see this plan's Global Constraints),
// so this is the closest instrumentable equivalent to the spec's "per new
// refund: build payload, create" framing while preserving every named
// guarantee -- one independent credit note per refund, processed
// oldest-first (already sorted by listNewRefundsStepFn), each addressed by
// its own deterministic creditNoteExternalCodeForRefund code.
export async function createCreditNotesForNewRefundsStepFn(
  input: {
    order: OrderDTO
    newRefunds: RefundDTO[]
    triggeredBy: CreditNoteTrigger
    invoiceExternalCode: string
  },
  { container }: StepCtx
): Promise<StepResponse<CreatedCreditNote[]>> {
  if (input.newRefunds.length === 0) {
    return new StepResponse([])
  }
  const abraFlexi = container.resolve<AbraFlexiModuleService>(ABRA_FLEXI_MODULE)
  const config = { vatPayer: !!abraFlexi.getOptions().vatPayer }
  const client = abraFlexi.getClient()
  const created: CreatedCreditNote[] = []

  try {
    for (const refund of input.newRefunds) {
      const payload =
        input.triggeredBy === "order_canceled"
          ? mapOrderToFullCreditNote(input.order, config, refund.id)
          : mapRefundToLumpSumCreditNote(input.order, config, {
              id: refund.id,
              amount: Number(refund.amount),
              note: refund.note,
            })
      const result = await client.createCreditNote({
        ...payload,
        originalInvoiceExternalCode: input.invoiceExternalCode,
      })
      created.push({ refundId: refund.id, creditNoteId: result.id, creditNoteCode: result.code })
    }
  } catch (e) {
    if (e instanceof AbraFlexiApiError && !e.retryable) {
      return StepResponse.permanentFailure(e.message)
    }
    throw e
  }

  return new StepResponse(created)
}
const createCreditNotesForNewRefundsStep = createStep(
  { name: "create-credit-notes-for-new-refunds", maxRetries: 3, retryInterval: 30 },
  createCreditNotesForNewRefundsStepFn
)

export async function persistRecordedRefundIdsStepFn(
  input: { order: OrderDTO; newRefundIds: string[] },
  { container }: StepCtx
): Promise<StepResponse<string[]>> {
  const existing = Array.isArray(input.order.metadata?.abra_flexi_recorded_refund_ids)
    ? (input.order.metadata!.abra_flexi_recorded_refund_ids as string[])
    : []
  if (input.newRefundIds.length === 0) {
    return new StepResponse(existing)
  }
  const orderModuleService = container.resolve(Modules.ORDER)
  const updated = [...existing, ...input.newRefundIds]
  await orderModuleService.updateOrders(input.order.id, {
    metadata: { ...(input.order.metadata ?? {}), abra_flexi_recorded_refund_ids: updated },
  })
  return new StepResponse(updated)
}
const persistRecordedRefundIdsStep = createStep(
  "persist-abra-flexi-recorded-refund-ids",
  persistRecordedRefundIdsStepFn
)

export const createCreditNoteInAbraFlexiWorkflow = createWorkflow(
  "create-credit-note-in-abra-flexi",
  (input: CreateCreditNoteInAbraFlexiInput) => {
    const resolved = resolveOrderByIdStep(input)

    const hasInvoice = transform(
      { resolved },
      ({ resolved }) => !!resolved.order.metadata?.abra_flexi_invoice_id
    )

    const recordedRefundIds = when({ hasInvoice }, ({ hasInvoice }) => hasInvoice).then(() => {
      const listInput = transform({ resolved }, ({ resolved }) => ({
        paymentIds: resolved.paymentIds,
        recordedRefundIds: Array.isArray(resolved.order.metadata?.abra_flexi_recorded_refund_ids)
          ? (resolved.order.metadata!.abra_flexi_recorded_refund_ids as string[])
          : [],
      }))
      const newRefunds = listNewRefundsStep(listInput)

      const createInput = transform(
        { resolved, newRefunds, input },
        ({ resolved, newRefunds, input }) => ({
          order: resolved.order,
          newRefunds,
          triggeredBy: input.triggeredBy,
          invoiceExternalCode: resolved.order.metadata?.abra_flexi_invoice_code as string,
        })
      )
      const created = createCreditNotesForNewRefundsStep(createInput)

      const persistInput = transform({ resolved, created }, ({ resolved, created }) => ({
        order: resolved.order,
        newRefundIds: created.map((c) => c.refundId),
      }))
      return persistRecordedRefundIdsStep(persistInput)
    })

    const result = transform(
      { resolved, recordedRefundIds },
      ({ resolved, recordedRefundIds }) => ({
        recordedRefundIds:
          recordedRefundIds ??
          (Array.isArray(resolved.order.metadata?.abra_flexi_recorded_refund_ids)
            ? (resolved.order.metadata!.abra_flexi_recorded_refund_ids as string[])
            : []),
      })
    )

    return new WorkflowResponse(result)
  }
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test -- create-credit-note-in-abra-flexi`
Expected: PASS.

- [ ] **Step 5: Export the workflow from `index.ts`**

In `packages/invoicing-abraflexi/src/index.ts`, add after the existing `recordPaymentInAbraFlexiWorkflow` export block:

```ts
export {
  createCreditNoteInAbraFlexiWorkflow,
  type CreateCreditNoteInAbraFlexiInput,
  type CreditNoteTrigger,
} from "./workflows/create-credit-note-in-abra-flexi.js"
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi typecheck`
Expected: no errors. Pay attention to `noUncheckedIndexedAccess` around every `order.metadata?.abra_flexi_*` access — the `Array.isArray` guards mirror the existing pattern in `record-payment-in-abra-flexi.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/invoicing-abraflexi/src/workflows/create-credit-note-in-abra-flexi.ts packages/invoicing-abraflexi/src/workflows/__tests__/create-credit-note-in-abra-flexi.test.ts packages/invoicing-abraflexi/src/index.ts
git commit -s -m "feat(invoicing-abraflexi): add createCreditNoteInAbraFlexiWorkflow

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015GVXnUEPzksefqEG62mekN"
```

---

### Task 4: Two new subscribers

**Files:**

- Create: `packages/invoicing-abraflexi/src/subscribers/payment-refunded.ts`
- Create: `packages/invoicing-abraflexi/src/subscribers/order-canceled.ts`
- Create: `packages/invoicing-abraflexi/src/subscribers/__tests__/payment-refunded.test.ts`
- Create: `packages/invoicing-abraflexi/src/subscribers/__tests__/order-canceled.test.ts`
- Modify: `packages/invoicing-abraflexi/README.md`

**Interfaces:**

- Consumes: `resolveOrderStepFn` (existing, from `create-invoice-in-abra-flexi.ts` — reused as-is, not duplicated, for `payment-refunded.ts`'s payment-id-to-order-id resolution); `createCreditNoteInAbraFlexiWorkflow` (Task 3).
- Produces: nothing new — these are the integration points, nothing else depends on them. Neither is exported from `index.ts` (matching `payment-captured.ts`, which isn't exported there either).

`payment-refunded.ts` reuses `resolveOrderStepFn` directly (calling the plain
function, not through its `createStep` wrapper) rather than re-deriving the
payment-to-order join with a fresh `query.graph` call — this is the literal
"same join `resolveOrderStepFn` already does" the spec calls for.

- [ ] **Step 1: Write the failing tests**

Create `packages/invoicing-abraflexi/src/subscribers/__tests__/payment-refunded.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"

vi.mock("../../workflows/create-invoice-in-abra-flexi", () => ({
  resolveOrderStepFn: vi.fn(),
}))
vi.mock("../../workflows/create-credit-note-in-abra-flexi", () => ({
  createCreditNoteInAbraFlexiWorkflow: vi.fn(),
}))

import abraFlexiPaymentRefundedHandler, { config } from "../payment-refunded"
import { resolveOrderStepFn } from "../../workflows/create-invoice-in-abra-flexi"
import { createCreditNoteInAbraFlexiWorkflow } from "../../workflows/create-credit-note-in-abra-flexi"

describe("payment-refunded subscriber", () => {
  it("listens on payment.refunded", () => {
    expect(config.event).toBe("payment.refunded")
  })

  it("resolves the order from the payment id and runs the credit-note workflow with triggeredBy: payment_refunded", async () => {
    ;(resolveOrderStepFn as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: { order: { id: "ord_1" } },
    })
    const run = vi.fn().mockResolvedValue({ result: { recordedRefundIds: ["ref_1"] } })
    ;(createCreditNoteInAbraFlexiWorkflow as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      run,
    })
    const container = {} as never

    await abraFlexiPaymentRefundedHandler({
      event: { data: { id: "pay_1" }, name: "payment.refunded" },
      container,
      pluginOptions: {},
    } as never)

    expect(resolveOrderStepFn).toHaveBeenCalledWith({ paymentId: "pay_1" }, { container })
    expect(createCreditNoteInAbraFlexiWorkflow).toHaveBeenCalledWith(container)
    expect(run).toHaveBeenCalledWith({
      input: { orderId: "ord_1", triggeredBy: "payment_refunded" },
    })
  })
})
```

Create `packages/invoicing-abraflexi/src/subscribers/__tests__/order-canceled.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"

vi.mock("../../workflows/create-credit-note-in-abra-flexi", () => ({
  createCreditNoteInAbraFlexiWorkflow: vi.fn(),
}))

import abraFlexiOrderCanceledHandler, { config } from "../order-canceled"
import { createCreditNoteInAbraFlexiWorkflow } from "../../workflows/create-credit-note-in-abra-flexi"

describe("order-canceled subscriber", () => {
  it("listens on order.canceled", () => {
    expect(config.event).toBe("order.canceled")
  })

  it("runs the credit-note workflow with the event's order id and triggeredBy: order_canceled", async () => {
    const run = vi.fn().mockResolvedValue({ result: { recordedRefundIds: ["ref_1", "ref_2"] } })
    ;(createCreditNoteInAbraFlexiWorkflow as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      run,
    })
    const container = {} as never

    await abraFlexiOrderCanceledHandler({
      event: { data: { id: "ord_1" }, name: "order.canceled" },
      container,
      pluginOptions: {},
    } as never)

    expect(createCreditNoteInAbraFlexiWorkflow).toHaveBeenCalledWith(container)
    expect(run).toHaveBeenCalledWith({
      input: { orderId: "ord_1", triggeredBy: "order_canceled" },
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test -- payment-refunded order-canceled`
Expected: FAIL — neither `../payment-refunded` nor `../order-canceled` module exists yet.

- [ ] **Step 3: Implement the subscribers**

Create `packages/invoicing-abraflexi/src/subscribers/payment-refunded.ts`:

```ts
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { resolveOrderStepFn } from "../workflows/create-invoice-in-abra-flexi.js"
import { createCreditNoteInAbraFlexiWorkflow } from "../workflows/create-credit-note-in-abra-flexi.js"

export default async function abraFlexiPaymentRefundedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>): Promise<void> {
  const resolved = await resolveOrderStepFn({ paymentId: data.id }, { container })
  await createCreditNoteInAbraFlexiWorkflow(container).run({
    input: { orderId: resolved.output.order.id, triggeredBy: "payment_refunded" },
  })
}

export const config: SubscriberConfig = {
  event: "payment.refunded",
}
```

Create `packages/invoicing-abraflexi/src/subscribers/order-canceled.ts`:

```ts
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { createCreditNoteInAbraFlexiWorkflow } from "../workflows/create-credit-note-in-abra-flexi.js"

export default async function abraFlexiOrderCanceledHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>): Promise<void> {
  await createCreditNoteInAbraFlexiWorkflow(container).run({
    input: { orderId: data.id, triggeredBy: "order_canceled" },
  })
}

export const config: SubscriberConfig = {
  event: "order.canceled",
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test -- payment-refunded order-canceled`
Expected: PASS, both files.

- [ ] **Step 5: Update the package README**

In `packages/invoicing-abraflexi/README.md`, replace the top summary paragraph:

```markdown
Abra Flexi invoicing for MedusaJS 2.0 (medusa-cz). Listens for `payment.captured`
to issue and mark paid a Czech sales invoice, and for `payment.refunded` /
`order.canceled` to issue a linked credit note (dobropis) for any new Medusa
refund — all via durable, retried Medusa workflows. Idempotent throughout: a
second capture, a replayed refund event, or a second cancellation never
re-creates an invoice, payment record, or credit note already recorded, while a
genuinely new payment or refund on the same order is still recorded.
```

Add to the end of the numbered "What it does" list (after the existing item 9):

```markdown
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
```

In the "Known gaps (by design, deferred)" section, replace the bullet:

```markdown
- **Credit notes, general ledger.** Separate sub-projects (3-4) of the Abra
  Flexi milestone — not built here. Payment status (sub-project 2) is built,
  via a direct field write, not a linked bank record — see
  `docs/superpowers/research/2026-09-06-abra-flexi-payment-api-verification.md`
  for why, and what upgrading to a bank-record-based approach would need.
```

with:

```markdown
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
```

In the "Wire-format field names" bullet, append after the existing last sentence:

```markdown
Separately, `typDokl: code:DOBROPIS` (credit notes, sub-project 3) carries
the same unverified-by-default caveat as `code:FAKTURA` — confirm both via
the live sandbox suite.
```

- [ ] **Step 6: Commit**

```bash
git add packages/invoicing-abraflexi/src/subscribers/payment-refunded.ts packages/invoicing-abraflexi/src/subscribers/order-canceled.ts packages/invoicing-abraflexi/src/subscribers/__tests__/payment-refunded.test.ts packages/invoicing-abraflexi/src/subscribers/__tests__/order-canceled.test.ts packages/invoicing-abraflexi/README.md
git commit -s -m "feat(invoicing-abraflexi): wire payment.refunded and order.canceled to credit notes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015GVXnUEPzksefqEG62mekN"
```

- [ ] **Step 7: Full package gate**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test && pnpm --filter @medusa-cz/invoicing-abraflexi typecheck && pnpm --filter @medusa-cz/invoicing-abraflexi build`
Expected: all green. This is the point the plan's Global Constraints call "Task 4 done" — no new module registration needed (Medusa auto-discovers subscribers by file location).

---

### Task 5: DB-backed idempotency integration test

**Files:**

- Modify: `packages/invoicing-abraflexi/src/__tests__/integration/idempotency/mock-abra-flexi-server.ts`
- Create: `packages/invoicing-abraflexi/src/__tests__/integration/idempotency/credit-note-idempotency.test.ts`

**Interfaces:**

- Consumes: `createCreditNoteInAbraFlexiWorkflow` (Task 3), `createInvoiceInAbraFlexiWorkflow` (existing), `startMockAbraFlexiServer` (extended below).
- Produces: nothing for later tasks — this is a leaf test.

The existing mock server tells apart invoice-create vs. payment-record calls
by body shape (both PUT to the same endpoint). `createCreditNote` adds two
_more_ distinct shapes to the same endpoint (create with `typDokl: DOBROPIS`,
then link with `vytvor-vazbu-dobropis`) — the mock needs two more counters so
this test can assert on them without disturbing the two existing idempotency
suites' `callCount()`/`paymentRecordCallCount()` usage.

- [ ] **Step 1: Extend the mock server (no test file changes needed for the existing two suites — verified by running them in Step 2)**

Replace the full contents of `packages/invoicing-abraflexi/src/__tests__/integration/idempotency/mock-abra-flexi-server.ts`:

```ts
import { createServer, type Server } from "node:http"

export interface MockAbraFlexiServer {
  baseUrl: string
  callCount: () => number
  paymentRecordCallCount: () => number
  creditNoteCreateCallCount: () => number
  creditNoteLinkCallCount: () => number
  close: () => Promise<void>
}

// Stands in for the real Abra Flexi API in the idempotency-guard integration
// tests (create-invoice-idempotency.test.ts, record-payment-idempotency.test.ts,
// credit-note-idempotency.test.ts). No network, no sandbox credentials -- just
// enough of PUT /c/{company}/faktura-vydana.json's response shape for
// AbraFlexiClient.createInvoice()/.recordPayment()/.createCreditNote() to each
// parse a success result (all four write shapes PUT to the same endpoint --
// see docs/superpowers/research/2026-09-07-abra-flexi-credit-notes-api-verification.md
// Part 1 for why credit notes reuse faktura-vydana.json too). The four call
// counters are told apart by body shape, most-specific first:
//   - a link PUT only ever carries `vytvor-vazbu-dobropis`
//   - a credit-note create PUT carries `typDokl: "code:DOBROPIS"` (and no link field)
//   - a payment-status PUT only ever carries `stavUhrK`
//   - anything else is a plain invoice create
// The tests assert on these counts to prove each workflow's own idempotency
// guard, not this mock, is what prevents duplicate calls on a
// retried/duplicated event.
export async function startMockAbraFlexiServer(): Promise<MockAbraFlexiServer> {
  let createCalls = 0
  let paymentRecordCalls = 0
  let creditNoteCreateCalls = 0
  let creditNoteLinkCalls = 0

  const server: Server = createServer((req, res) => {
    if (req.method === "PUT" && req.url?.endsWith("/faktura-vydana.json")) {
      const chunks: Buffer[] = []
      req.on("data", (chunk: Buffer) => chunks.push(chunk))
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
        const invoice = body?.winstrom?.["faktura-vydana"] ?? {}
        const isLink = "vytvor-vazbu-dobropis" in invoice
        const isCreditNoteCreate = !isLink && invoice.typDokl === "code:DOBROPIS"
        const isPaymentRecord = !isLink && !isCreditNoteCreate && "stavUhrK" in invoice

        let id: number
        if (isLink) {
          creditNoteLinkCalls++
          id = creditNoteLinkCalls
        } else if (isCreditNoteCreate) {
          creditNoteCreateCalls++
          id = creditNoteCreateCalls
        } else if (isPaymentRecord) {
          paymentRecordCalls++
          id = paymentRecordCalls
        } else {
          createCalls++
          id = createCalls
        }

        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ winstrom: { success: true, results: [{ id: String(id) }] } }))
      })
      return
    }
    res.writeHead(404)
    res.end()
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })

  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("Mock Abra Flexi server failed to bind a local port")
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    callCount: () => createCalls,
    paymentRecordCallCount: () => paymentRecordCalls,
    creditNoteCreateCallCount: () => creditNoteCreateCalls,
    creditNoteLinkCallCount: () => creditNoteLinkCalls,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
```

- [ ] **Step 2: Run the two existing idempotency tests to confirm nothing broke**

Requires a real Postgres — see this plan's Global Constraints. If you don't
have one reachable right now, skip straight to Step 3 (RED) and come back to
run Steps 2/4/6 together once you do; do not skip verifying this for real
before Step 7's commit.

Run: `DB_HOST=localhost DB_USERNAME=<user> DB_PASSWORD=<pass> DB_PORT=5432 pnpm --filter @medusa-cz/invoicing-abraflexi test:integration -- create-invoice-idempotency record-payment-idempotency`
Expected: PASS, unchanged — `callCount()`/`paymentRecordCallCount()` still count only their own shapes.

- [ ] **Step 3: Write the failing test**

Create `packages/invoicing-abraflexi/src/__tests__/integration/idempotency/credit-note-idempotency.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { asValue } from "@medusajs/framework/awilix"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework"
import { createInvoiceInAbraFlexiWorkflow } from "../../../workflows/create-invoice-in-abra-flexi.js"
import { createCreditNoteInAbraFlexiWorkflow } from "../../../workflows/create-credit-note-in-abra-flexi.js"
import { ABRA_FLEXI_MODULE } from "../../../modules/abra-flexi/index.js"
import AbraFlexiModuleService from "../../../modules/abra-flexi/service.js"
import { startMockAbraFlexiServer, type MockAbraFlexiServer } from "./mock-abra-flexi-server.js"

// Sibling to create-invoice-idempotency.test.ts / record-payment-idempotency.test.ts's
// guard coverage -- proves createCreditNoteInAbraFlexiWorkflow's own
// idempotency guard (order.metadata.abra_flexi_recorded_refund_ids) survives
// a real round trip through Postgres, same DB_HOST/pg-god/SSL requirements as
// those files (not repeated here).
//
// Exercises *two* refunds on the same order, per the design spec's explicit
// acceptance requirement ("at least two refunds on one order, proving the
// second one isn't dropped") -- a single-refund test could pass even with a
// per-order (not per-refund-id) guard bug that a real multi-refund business
// case would hit.
const hasDb = !!process.env.DB_HOST
const run = hasDb ? medusaIntegrationTestRunner : skippedSuite

let mock: MockAbraFlexiServer

run({
  cwd: __dirname,
  hooks: {
    beforeServerStart: async (container: MedusaContainer) => {
      mock = await startMockAbraFlexiServer()
      container.register({
        [ABRA_FLEXI_MODULE]: asValue(
          new AbraFlexiModuleService(
            {},
            {
              baseUrl: mock.baseUrl,
              company: "1",
              username: "test",
              password: "test",
              vatPayer: false,
            }
          )
        ),
      })
    },
  },
  testSuite: ({ getContainer }) => {
    describe("Abra Flexi credit-note idempotency guard (DB-backed)", () => {
      afterAll(async () => {
        await mock.close()
      })

      it("creates one credit note per new refund, never re-creates one already recorded", async () => {
        const container = getContainer()
        const orderModuleService = container.resolve(Modules.ORDER)
        const paymentModuleService = container.resolve(Modules.PAYMENT)
        const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)

        const order = await orderModuleService.createOrders({
          email: "zakaznik@example.cz",
          currency_code: "czk",
          items: [{ title: "Tričko", quantity: 1, unit_price: 300 }],
          billing_address: { first_name: "Jan", last_name: "Novák" },
        })

        const paymentCollection = await paymentModuleService.createPaymentCollections({
          currency_code: "czk",
          amount: 300,
        })

        await remoteLink.create({
          [Modules.ORDER]: { order_id: order.id },
          [Modules.PAYMENT]: { payment_collection_id: paymentCollection.id },
        })

        const session = await paymentModuleService.createPaymentSession(paymentCollection.id, {
          provider_id: "pp_system_default",
          currency_code: "czk",
          amount: 300,
          data: {},
        })
        const payment = await paymentModuleService.authorizePaymentSession(session.id, {})
        await paymentModuleService.capturePayment({ payment_id: payment.id })

        await createInvoiceInAbraFlexiWorkflow(container).run({
          input: { paymentId: payment.id },
        })

        // First refund.
        await paymentModuleService.refundPayment({ payment_id: payment.id, amount: 100 })

        const firstRun = await createCreditNoteInAbraFlexiWorkflow(container).run({
          input: { orderId: order.id, triggeredBy: "payment_refunded" },
        })
        expect(mock.creditNoteCreateCallCount()).toBe(1)
        expect(mock.creditNoteLinkCallCount()).toBe(1)
        expect(firstRun.result.recordedRefundIds).toHaveLength(1)

        // Re-running with no new refunds must be a no-op.
        const secondRun = await createCreditNoteInAbraFlexiWorkflow(container).run({
          input: { orderId: order.id, triggeredBy: "payment_refunded" },
        })
        expect(mock.creditNoteCreateCallCount()).toBe(1)
        expect(mock.creditNoteLinkCallCount()).toBe(1)
        expect(secondRun.result.recordedRefundIds).toEqual(firstRun.result.recordedRefundIds)

        // A second, different refund on the same order/payment must NOT be
        // dropped -- the headline correctness property of per-refund-id (not
        // per-order, not per-payment) idempotency.
        await paymentModuleService.refundPayment({ payment_id: payment.id, amount: 50 })

        const thirdRun = await createCreditNoteInAbraFlexiWorkflow(container).run({
          input: { orderId: order.id, triggeredBy: "payment_refunded" },
        })
        expect(mock.creditNoteCreateCallCount()).toBe(2)
        expect(mock.creditNoteLinkCallCount()).toBe(2)
        expect(thirdRun.result.recordedRefundIds).toHaveLength(2)
      })
    })
  },
})

function skippedSuite() {
  describe.skip("Abra Flexi credit-note idempotency guard (DB-backed) -- skipped, DB_HOST not set", () => {
    it("requires DB_HOST/DB_USERNAME/DB_PASSWORD/DB_PORT env vars pointing at a real Postgres", () => {})
  })
}
```

- [ ] **Step 4: Run to verify RED, then GREEN**

Run: `DB_HOST=localhost DB_USERNAME=<user> DB_PASSWORD=<pass> DB_PORT=5432 pnpm --filter @medusa-cz/invoicing-abraflexi test:integration -- credit-note-idempotency`

If `createCreditNoteInAbraFlexiWorkflow` (Task 3) isn't implemented yet at the
point you run this, expect FAIL (module not found) — that's the RED you're
verifying. Once Task 3 is done (it should already be, per this plan's task
order), expect PASS: `creditNoteCreateCallCount()`/`creditNoteLinkCallCount()`
go `1 → 1 → 2` across the three workflow runs.

If `DB_HOST` isn't set, this suite reports itself as skipped (see
`skippedSuite()`) — that is **not** the same as passing. Per this repo's
standing rule (`CLAUDE.md`'s `test:integration` section), do not commit this
task claiming verification without having actually run it against a real
Postgres at least once — if no Postgres is reachable in this environment,
say so explicitly in the final report instead of silently treating "skipped"
as "passing."

- [ ] **Step 5: Run the full package gate**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test && pnpm --filter @medusa-cz/invoicing-abraflexi typecheck && pnpm --filter @medusa-cz/invoicing-abraflexi build`
Expected: all green (this run does not require `DB_HOST` — the integration
directory is excluded from the plain `test`/`build`/`typecheck` gate per
`vitest.config.ts`).

- [ ] **Step 6: Commit**

```bash
git add packages/invoicing-abraflexi/src/__tests__/integration/idempotency/mock-abra-flexi-server.ts packages/invoicing-abraflexi/src/__tests__/integration/idempotency/credit-note-idempotency.test.ts
git commit -s -m "test(invoicing-abraflexi): DB-backed idempotency guard for credit notes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015GVXnUEPzksefqEG62mekN"
```

---

### Task 6: Extend the live opt-in sandbox suite

**Files:**

- Modify: `packages/invoicing-abraflexi/src/__tests__/integration/abra-flexi-sandbox.test.ts`

**Interfaces:**

- Consumes: `AbraFlexiClient.createCreditNote` (Task 1).
- Produces: nothing — leaf test, and the real verification gate for the two
  "not verified against a live instance" items the spec/research doc both flag
  explicitly: whether `code:DOBROPIS` exists by default, and whether the link
  actually takes effect. Nothing in Tasks 1-5 fires a real request.

- [ ] **Step 1: Add the live test case**

Add to `packages/invoicing-abraflexi/src/__tests__/integration/abra-flexi-sandbox.test.ts`, a new helper function after the existing `fetchStavUhrK` function:

```ts
// Reads the credit note's own `dobropisovanyDokl` field back via a plain GET
// -- the real assertion for "did the link PUT actually take", not just that
// Abra Flexi accepted two separate writes (an unlinked credit note and a
// no-op link call would both return a truthy id either way). Field name per
// docs/superpowers/research/2026-09-07-abra-flexi-credit-notes-api-verification.md
// Part 1's XML example -- unchanged in JSON, same as this file's existing
// fetchStavUhrK helper does for stavUhrK.
async function fetchDobropisovanyDokl(externalCode: string): Promise<string | undefined> {
  const auth = "Basic " + Buffer.from(`${username}:${password}`).toString("base64")
  const res = await fetch(
    `${baseUrl}/c/${company}/faktura-vydana/code:${encodeURIComponent(externalCode)}.json?detail=full`,
    { headers: { Authorization: auth } }
  )
  const body = (await res.json()) as {
    winstrom?: { "faktura-vydana"?: { dobropisovanyDokl?: string }[] }
  }
  return body.winstrom?.["faktura-vydana"]?.[0]?.dobropisovanyDokl
}
```

Then add this test inside the existing `run("Abra Flexi sandbox (live)", () => { ... })` block, after the existing `it("records a payment against a just-created invoice", ...)` case:

```ts
it("creates a credit note and links it to a just-created invoice", async () => {
  const client = new AbraFlexiClient({
    baseUrl: baseUrl!,
    company: company!,
    username: username!,
    password: password!,
  })

  const invoiceExternalCode = `sandbox-test-invoice-for-credit-${Date.now()}`
  await client.createInvoice({
    externalCode: invoiceExternalCode,
    currency: "CZK",
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    customer: { name: "Sandbox Test Customer", countryCode: "CZ" },
    lines: [{ name: "Integration test item", quantity: 1, unitPrice: 100 }],
    vatPayer: false,
  })

  const creditNoteExternalCode = `sandbox-test-credit-${Date.now()}`
  const result = await client.createCreditNote({
    externalCode: creditNoteExternalCode,
    originalInvoiceExternalCode: invoiceExternalCode,
    currency: "CZK",
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    customer: { name: "Sandbox Test Customer", countryCode: "CZ" },
    lines: [{ name: "Refund", quantity: -1, unitPrice: 100 }],
    vatPayer: false,
  })

  expect(result.id).toBeTruthy()
  expect(result.code).toBe(creditNoteExternalCode)

  const linkedTo = await fetchDobropisovanyDokl(creditNoteExternalCode)
  expect(linkedTo).toContain(invoiceExternalCode)
})
```

- [ ] **Step 2: Run against the real sandbox**

Requires real `ABRA_FLEXI_*` credentials as process env vars (see this
package's `README.md` "Options" table) — none exist anywhere as of this plan
being written (confirmed this session).

Run: `ABRA_FLEXI_BASE_URL=... ABRA_FLEXI_COMPANY=... ABRA_FLEXI_USERNAME=... ABRA_FLEXI_PASSWORD=... pnpm --filter @medusa-cz/invoicing-abraflexi test:integration -- abra-flexi-sandbox`

Expected: PASS. **If this fails, do not "fix" it by guessing a different
field name** — re-check
`docs/superpowers/research/2026-09-07-abra-flexi-credit-notes-api-verification.md`
Part 1 against the real error message (particularly whether `code:DOBROPIS`
needs one-time setup in this business's company, per the research doc's
"Not verified against a live instance" section) before changing
`abra-flexi-client.ts`.

If no live credentials are available in this environment, this suite reports
itself as skipped — say so explicitly rather than treating Tasks 1-5's green
mocked tests as proof this works against the real API. Flag it back to
whoever can run it with real credentials before this ships to production
traffic.

- [ ] **Step 3: Commit**

```bash
git add packages/invoicing-abraflexi/src/__tests__/integration/abra-flexi-sandbox.test.ts
git commit -s -m "test(invoicing-abraflexi): live sandbox coverage for createCreditNote

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015GVXnUEPzksefqEG62mekN"
```

---

## Done when

- All six tasks committed.
- `pnpm --filter @medusa-cz/invoicing-abraflexi test`, `typecheck`, `build`
  all green.
- Task 5's DB-backed test has actually been run against a real Postgres at
  least once (not just left to report "skipped") — if no Postgres is
  reachable in the executing environment, this must be stated explicitly as
  unverified, not silently passed over.
- Task 6's live sandbox test has either actually been run against real Abra
  Flexi credentials, or been explicitly flagged as not yet verified live —
  never silently assumed to work.
- The design spec's acceptance summary
  (`docs/superpowers/specs/2026-09-07-m4-credit-notes-design.md`, "Acceptance
  summary") holds: every new `RefundDTO` discovered on an order that already
  has an Abra Flexi invoice results in exactly one linked Abra Flexi credit
  note, idempotently, regardless of which event discovered it; a full order
  cancellation produces a full negated-mirror credit note; an explicit
  partial/full payment refund produces a single lump-sum credit note; a
  second refund on the same order is never dropped nor duplicated; an order
  with no invoice yet produces no credit note.
- A final independent review of the whole branch's diff has been performed
  (see this plan's execution instructions) and any findings fixed before
  calling the sub-project done.
