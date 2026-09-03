# Abra Flexi Invoice Issuance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the never-implemented `@medusa-cz/invoicing-fakturoid` skeleton with a real `@medusa-cz/invoicing-abraflexi` module that issues a Czech sales invoice in Abra Flexi automatically when a Medusa order's payment is captured, using a Medusa workflow with durable, retried steps.

**Architecture:** A `payment.captured` subscriber invokes a Medusa workflow (`createInvoiceInAbraFlexiWorkflow`) built from five steps: resolve the order from the payment id, guard against double-invoicing via `order.metadata.abra_flexi_invoice_id`, map the order to an Abra Flexi invoice payload (pure function), POST it to Abra Flexi via a typed HTTP client (retried by the workflow engine on transient failure, permanently failed on 4xx), and persist the resulting invoice id/code back onto `order.metadata`. Follows `packages/payment-comgate`'s file layout and TDD discipline.

**Tech Stack:** TypeScript, Medusa v2.17.0 workflows-sdk (`createStep`/`createWorkflow`/`StepResponse`/`WorkflowResponse`/`when`/`transform`), vitest, `@medusa-cz/shared` (`isValidIco`), native `fetch`.

**Spec:** `docs/superpowers/specs/2026-09-02-m4-abra-flexi-invoicing-design.md` — this plan implements that spec's sub-project 1 (invoice issuance) only; sub-projects 2-4 (payment sync, credit notes, general ledger) and the storefront IČO/DIČ UI are explicitly out of scope here.

## Global Constraints

- Node >=20, TypeScript strict mode (`tsconfig.base.json`: `strict: true`, `noUncheckedIndexedAccess: true`) — every array/record index access needs a null check or non-null assertion, matching the rest of the repo.
- Medusa packages are pinned to **2.17.0** across the monorepo (`@medusajs/framework`, `@medusajs/medusa`, etc.) — match that exact version in the new package's `package.json`, copied from `packages/payment-comgate/package.json`.
- TDD per `CLAUDE.md`: RED → GREEN → REFACTOR, one behavior per test, matching the Comgate/Packeta suites' style (see `packages/payment-comgate/src/core/__tests__/comgate-client.test.ts` for the established mocked-`fetch` pattern).
- Conventional Commits, `git commit -s` (DCO sign-off) on every commit.
- Package test gate (`pnpm --filter @medusa-cz/invoicing-abraflexi test`, `typecheck`, `build`) must be green **before** Task 9 (backend registration) — this mirrors the Packeta M2a plan's Task 12 ordering.
- `.medusa/server` build output and `node_modules` are never hand-edited or committed (already gitignored via the workspace's shared `.gitignore`/`eslint.config.js` `ignores`).
- Abra Flexi's wire JSON field names used in Task 3 (`datVyd`, `splatnost`, `mena`, `nazFirma`, `ulice`, `mesto`, `psc`, `stat`, `ic`, `dic`, `typDokl`, the `winstrom` envelope, the `code:`/`ext:` external-id prefix convention) are verified against Abra Flexi's own public support docs (cited inline in Task 3). The line-items array shape (`polozkyFaktury` / `faktura-vydana-polozka` / `nazev` / `mnozMj` / `cenaMj` / `typCenyDphK` / `typSzbDphK`) is corroborated by a community-maintained API reference but has **no first-party JSON example** for this specific evidence type — Task 7's opt-in live suite is the real verification gate for that piece before this goes live; do not skip running it against a real/sandbox Abra Flexi instance before enabling in production.

---

## 1. File structure

```
packages/invoicing-abraflexi/            # renamed from invoicing-fakturoid
  package.json                            # renamed, deps updated (Task 1)
  tsconfig.json                           # copied verbatim from invoicing-fakturoid (Task 1)
  vitest.config.ts                        # new — excludes src/__tests__/integration (Task 1)
  README.md                               # rewritten (Task 8)
  src/
    types.ts                              # all shared types + named constants (Task 1)
    index.ts                              # barrel export (Task 4)
    core/
      abra-flexi-client.ts                # REST wrapper: auth, createInvoice() (Task 2)
      __tests__/
        abra-flexi-client.test.ts         # (Task 2)
      order-to-invoice-mapper.ts          # pure function: Order + config -> AbraFlexiInvoicePayload (Task 3)
      __tests__/
        order-to-invoice-mapper.test.ts   # (Task 3)
    modules/
      abra-flexi/
        index.ts                          # Module registration (Task 4)
        service.ts                        # thin; holds options, hands out a configured client (Task 4)
    workflows/
      create-invoice-in-abra-flexi.ts     # 5-step workflow (Task 5)
      __tests__/
        create-invoice-in-abra-flexi.test.ts  # (Task 5)
    subscribers/
      payment-captured.ts                 # thin: event -> workflow.run (Task 6)
      __tests__/
        payment-captured.test.ts          # (Task 6)
    __tests__/
      integration/
        abra-flexi-sandbox.test.ts        # opt-in live suite (Task 7)
```

`packages/invoicing-fakturoid`'s current contents (`src/modules/fakturoid/`, `src/subscribers/order-placed.ts`, `src/index.ts`, `README.md`) are deleted outright in Task 1 — per the spec, there is nothing to migrate (M0 skeleton, no logic, no tests).

---

### Task 1: Package scaffold — rename, config, and shared types

**Files:**

- Rename directory: `packages/invoicing-fakturoid/` → `packages/invoicing-abraflexi/`
- Delete: `packages/invoicing-abraflexi/src/modules/fakturoid/index.ts`, `packages/invoicing-abraflexi/src/modules/fakturoid/service.ts`, `packages/invoicing-abraflexi/src/subscribers/order-placed.ts`, `packages/invoicing-abraflexi/src/index.ts`, `packages/invoicing-abraflexi/README.md`
- Modify: `packages/invoicing-abraflexi/package.json`
- Create: `packages/invoicing-abraflexi/vitest.config.ts`
- Create: `packages/invoicing-abraflexi/src/types.ts`
- Modify: `CLAUDE.md` (package list line), `AGENTS.md` (matching line, currently untracked but present on disk), `README.md` (package table row)
- Keep as-is: `packages/invoicing-abraflexi/tsconfig.json`, `packages/invoicing-abraflexi/src/admin/.gitkeep`

**Interfaces:**

- Produces (used by every later task): the full `types.ts` contract below — exact names matter, later tasks import from `../types.js`.

- [ ] **Step 1: Rename the package directory and delete the Fakturoid skeleton's logic**

```bash
git mv packages/invoicing-fakturoid packages/invoicing-abraflexi
git rm packages/invoicing-abraflexi/src/modules/fakturoid/index.ts \
       packages/invoicing-abraflexi/src/modules/fakturoid/service.ts \
       packages/invoicing-abraflexi/src/subscribers/order-placed.ts \
       packages/invoicing-abraflexi/src/index.ts \
       packages/invoicing-abraflexi/README.md
rmdir packages/invoicing-abraflexi/src/modules/fakturoid 2>/dev/null || true
```

(`rmdir` may no-op/fail harmlessly on some shells if the directory is already gone after `git rm` — that's fine, ignore the error.)

- [ ] **Step 2: Rewrite `package.json`**

Replace the entire file with:

```json
{
  "name": "@medusa-cz/invoicing-abraflexi",
  "version": "0.0.1",
  "description": "Abra Flexi invoicing for MedusaJS 2.0 (medusa-cz).",
  "license": "MIT",
  "files": [".medusa/server"],
  "exports": {
    "./package.json": "./package.json",
    "./modules/*": "./.medusa/server/src/modules/*/index.js",
    "./*": "./.medusa/server/src/*.js"
  },
  "keywords": ["medusa", "medusa-plugin", "medusa-v2", "invoicing", "abra-flexi", "czech"],
  "publishConfig": {
    "access": "public"
  },
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "medusa plugin:build",
    "dev": "medusa plugin:develop",
    "prepublishOnly": "medusa plugin:build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --dir src/__tests__/integration",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src"
  },
  "dependencies": {
    "@medusa-cz/shared": "workspace:*"
  },
  "devDependencies": {
    "@medusajs/admin-sdk": "2.17.0",
    "@medusajs/admin-shared": "2.17.0",
    "@medusajs/cli": "2.17.0",
    "@medusajs/framework": "2.17.0",
    "@medusajs/icons": "2.17.0",
    "@medusajs/medusa": "2.17.0",
    "@medusajs/test-utils": "2.17.0",
    "@medusajs/ui": "4.1.17",
    "typescript": "^5.6.2",
    "vitest": "^2.1.0"
  },
  "peerDependencies": {
    "@medusajs/framework": "2.17.0",
    "@medusajs/medusa": "2.17.0"
  }
}
```

This mirrors `packages/fulfillment-packeta/package.json` (which already depends on `@medusajs/test-utils` for its Task 13 integration test) with the module-provider `providers/*` export swapped for a plain-module `modules/*` export, and `@medusa-cz/shared` added as a runtime dependency for `isValidIco` (Task 3).

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    // The opt-in live suite is excluded from the default (gate) run.
    exclude: ["**/node_modules/**", "src/__tests__/integration/**"],
  },
})
```

(Identical to `packages/fulfillment-packeta/vitest.config.ts`.)

- [ ] **Step 4: Write `src/types.ts`**

```ts
export interface AbraFlexiOptions {
  /** e.g. "https://yourcompany.flexibee.eu" (cloud) or a self-hosted server URL, no trailing slash required */
  baseUrl: string
  /** company/evidence slug in the URL path, e.g. "yourcompany_s_r_o" */
  company: string
  username: string
  password: string
  /** default false — the business is currently "neplátce" (not VAT-registered) */
  vatPayer?: boolean
}

export interface AbraFlexiCustomer {
  name: string
  street?: string
  city?: string
  postalCode?: string
  /** ISO 3166-1 alpha-2, upper-case, e.g. "CZ" */
  countryCode?: string
  ico?: string
  dic?: string
}

export interface AbraFlexiInvoiceLine {
  name: string
  quantity: number
  /** major units, net of VAT */
  unitPrice: number
  /** CZ_VAT_RATE_BASIC when the invoice is VAT-payer; undefined when it isn't */
  vatRate?: number
}

export interface AbraFlexiInvoicePayload {
  /** our idempotency key, sent to Abra Flexi as the record's external id (see AbraFlexiClient) */
  externalCode: string
  /** ISO 4217, upper-case, e.g. "CZK" */
  currency: string
  /** YYYY-MM-DD */
  issueDate: string
  /** YYYY-MM-DD */
  dueDate: string
  customer: AbraFlexiCustomer
  lines: AbraFlexiInvoiceLine[]
  vatPayer: boolean
}

export interface AbraFlexiInvoiceResult {
  id: string
  code: string
}

// The current CZ statutory basic VAT rate (zákon č. 235/2004 Sb., o dani z přidané
// hodnoty, §47) — set by law, changes rarely but not never. Named constant per the
// design spec so a future rate change is a one-line edit, not a hunt through the code.
export const CZ_VAT_RATE_BASIC = 0.21

// Abra Flexi's rate-class code for the basic VAT rate (winstrom `typSzbDphK` field),
// verified against https://podpora.flexibee.eu/en/articles/3935269-order-fulfillment-in-json-format
export const ABRA_FLEXI_VAT_RATE_CODE_BASIC = "typSzbDph.dphZakl"

// Net payment terms applied to every issued invoice. Not specified by the design spec;
// 14 days is the common CZ B2C default. Revisit if the business needs per-order terms.
export const ABRA_FLEXI_DEFAULT_DUE_DAYS = 14
```

- [ ] **Step 5: Update `CLAUDE.md`'s package list**

In `CLAUDE.md`, find the line:

```
- `packages/invoicing-fakturoid` — Fakturoid invoicing module
```

Replace with:

```
- `packages/invoicing-abraflexi` — Abra Flexi invoicing module
```

- [ ] **Step 6: Update `AGENTS.md`**

`AGENTS.md` (repo root, currently untracked on disk — created in a prior session, not yet committed) has the identical line at line 15:

```
- `packages/invoicing-fakturoid` — Fakturoid invoicing module
```

Apply the same edit as Step 5.

- [ ] **Step 7: Update `README.md`'s package table**

In the root `README.md`, find the table row (line 16):

```
| `@medusa-cz/invoicing-fakturoid` | Fakturoid invoicing (order → invoice)                                       | planned (M4) |
```

Replace with:

```
| `@medusa-cz/invoicing-abraflexi` | Abra Flexi invoicing (order → invoice)                                      | in progress (M4) |
```

(Table column alignment doesn't need to be pixel-perfect — markdown tables render fine either way — but keep the row's cell content accurate.)

- [ ] **Step 8: Install and verify the scaffold compiles**

Run: `pnpm install` (from repo root — links the renamed workspace package and the new `@medusa-cz/shared` dependency)
Run: `pnpm --filter @medusa-cz/invoicing-abraflexi typecheck`
Expected: both succeed. `typecheck` passes trivially since `types.ts` has no logic yet and nothing imports it.

- [ ] **Step 9: Commit**

```bash
git add -A packages/invoicing-abraflexi packages/invoicing-fakturoid CLAUDE.md AGENTS.md README.md pnpm-lock.yaml
git commit -s -m "feat(invoicing): scaffold invoicing-abraflexi package (renamed from invoicing-fakturoid)"
```

---

### Task 2: Abra Flexi HTTP client

**Files:**

- Create: `packages/invoicing-abraflexi/src/core/abra-flexi-client.ts`
- Create: `packages/invoicing-abraflexi/src/core/__tests__/abra-flexi-client.test.ts`

**Interfaces:**

- Consumes: `AbraFlexiOptions`, `AbraFlexiInvoicePayload`, `AbraFlexiInvoiceResult`, `ABRA_FLEXI_VAT_RATE_CODE_BASIC` from `../types.js` (Task 1).
- Produces: `AbraFlexiApiError` (class, `status: number`, `retryable: boolean`), `AbraFlexiClient` (class, `constructor(opts: AbraFlexiOptions & { fetchFn?: typeof fetch })`, `createInvoice(payload: AbraFlexiInvoicePayload): Promise<AbraFlexiInvoiceResult>`) — both consumed by Task 4 (`service.ts`) and Task 5 (workflow step 4).

Abra Flexi's REST API (verified against its public docs — [Order Fulfillment in JSON Format](https://podpora.flexibee.eu/en/articles/3935269-order-fulfillment-in-json-format), [Invoice Issued](https://podpora.flexibee.eu/en/articles/4538946-invoice-issued), [Error Handling](https://podpora.flexibee.eu/en/articles/4720060-error-handling), [Record Identifiers](https://podpora.flexibee.eu/en/articles/4725798-record-identifiers)):

- Every record type ("evidence") lives at `{baseUrl}/c/{company}/{evidence}.json`; `faktura-vydana` is the issued-invoice evidence.
- `PUT` (or `POST` — Abra Flexi treats them identically) a `{ winstrom: { "faktura-vydana": {...} } }` envelope to that URL creates or updates the record.
- HTTP Basic auth (username/password).
- A record's `id` field accepts a `code:` or `ext:` prefixed external identifier instead of Abra Flexi's own numeric id — this is what makes `createInvoice` naturally idempotent: retrying with the same `externalCode` updates the same record instead of creating a duplicate.
- Response envelope on write: `{ winstrom: { success: boolean, results?: [{ id, errors?: [{ message, code? }] }] } }`.
- HTTP status codes: 200/201 success, 400 bad request, 401 unauthenticated, 402/403 forbidden, 404 not found, 500 server error — `>= 500` is treated as retryable (transient), everything else is not.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { AbraFlexiClient, AbraFlexiApiError } from "../abra-flexi-client"
import { ABRA_FLEXI_VAT_RATE_CODE_BASIC } from "../../types"
import type { AbraFlexiInvoicePayload } from "../../types"

const opts = {
  baseUrl: "https://demo.flexibee.eu:5434",
  company: "demo_company",
  username: "winstrom",
  password: "winstrom",
}

const payload: AbraFlexiInvoicePayload = {
  externalCode: "order-ord_123",
  currency: "CZK",
  issueDate: "2026-09-03",
  dueDate: "2026-09-17",
  customer: {
    name: "Jan Novák",
    street: "Hlavní 1",
    city: "Praha",
    postalCode: "11000",
    countryCode: "CZ",
  },
  lines: [{ name: "Tričko", quantity: 2, unitPrice: 299 }],
  vatPayer: false,
}

function mockFetchOnce(status: number, body: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch
}

describe("AbraFlexiClient.createInvoice", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("PUTs to the faktura-vydana collection URL with Basic auth", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "12345" }] } })
    const client = new AbraFlexiClient(opts)
    await client.createInvoice(payload)
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(call[0]).toBe("https://demo.flexibee.eu:5434/c/demo_company/faktura-vydana.json")
    expect(call[1].method).toBe("PUT")
    expect(call[1].headers.Authorization).toBe(
      "Basic " + Buffer.from("winstrom:winstrom").toString("base64")
    )
    expect(call[1].headers["Content-Type"]).toBe("application/json")
  })

  it("sends the external id, dates, currency, and customer fields", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "12345" }] } })
    await new AbraFlexiClient(opts).createInvoice(payload)
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    const body = JSON.parse(call[1].body)
    const invoice = body.winstrom["faktura-vydana"]
    expect(invoice.id).toBe("code:order-ord_123")
    expect(invoice.datVyd).toBe("2026-09-03")
    expect(invoice.splatnost).toBe("2026-09-17")
    expect(invoice.mena).toBe("code:CZK")
    expect(invoice.nazFirma).toBe("Jan Novák")
    expect(invoice.ulice).toBe("Hlavní 1")
    expect(invoice.mesto).toBe("Praha")
    expect(invoice.psc).toBe("11000")
    expect(invoice.stat).toBe("code:CZ")
  })

  it("omits ic/dic when not provided, and includes them when present", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "1" }] } })
    await new AbraFlexiClient(opts).createInvoice(payload)
    let body = JSON.parse(
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body
    )
    expect(body.winstrom["faktura-vydana"].ic).toBeUndefined()

    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "1" }] } })
    await new AbraFlexiClient(opts).createInvoice({
      ...payload,
      customer: { ...payload.customer, ico: "25063677", dic: "CZ25063677" },
    })
    body = JSON.parse(
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[1]![1].body
    )
    expect(body.winstrom["faktura-vydana"].ic).toBe("25063677")
    expect(body.winstrom["faktura-vydana"].dic).toBe("CZ25063677")
  })

  it("sends each line without VAT fields when vatRate is unset (non-payer)", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "1" }] } })
    await new AbraFlexiClient(opts).createInvoice(payload)
    const body = JSON.parse(
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body
    )
    const line = body.winstrom["faktura-vydana"].polozkyFaktury[0]["faktura-vydana-polozka"]
    expect(line).toEqual({ nazev: "Tričko", mnozMj: 2, cenaMj: 299 })
  })

  it("tags each line with the basic VAT rate code when vatRate is set (payer)", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "1" }] } })
    await new AbraFlexiClient(opts).createInvoice({
      ...payload,
      vatPayer: true,
      lines: [{ name: "Tričko", quantity: 2, unitPrice: 299, vatRate: 0.21 }],
    })
    const body = JSON.parse(
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body
    )
    const line = body.winstrom["faktura-vydana"].polozkyFaktury[0]["faktura-vydana-polozka"]
    expect(line.typCenyDphK).toBe("typCeny.bezDph")
    expect(line.typSzbDphK).toBe(ABRA_FLEXI_VAT_RATE_CODE_BASIC)
  })

  it("resolves with the numeric id and our external code", async () => {
    mockFetchOnce(201, { winstrom: { success: true, results: [{ id: "12345" }] } })
    const result = await new AbraFlexiClient(opts).createInvoice(payload)
    expect(result).toEqual({ id: "12345", code: "order-ord_123" })
  })

  it("throws a retryable AbraFlexiApiError on a 5xx response", async () => {
    mockFetchOnce(500, {
      winstrom: { success: false, results: [{ id: "0", errors: [{ message: "boom" }] }] },
    })
    await expect(new AbraFlexiClient(opts).createInvoice(payload)).rejects.toMatchObject({
      name: "AbraFlexiApiError",
      status: 500,
      retryable: true,
      message: "boom",
    })
  })

  it("throws a non-retryable AbraFlexiApiError on a 400 response", async () => {
    mockFetchOnce(400, {
      winstrom: { success: false, results: [{ id: "0", errors: [{ message: "Invalid mena" }] }] },
    })
    await expect(new AbraFlexiClient(opts).createInvoice(payload)).rejects.toMatchObject({
      name: "AbraFlexiApiError",
      status: 400,
      retryable: false,
      message: "Invalid mena",
    })
  })

  it("falls back to a generic message when the error body has no errors array", async () => {
    mockFetchOnce(401, {})
    await expect(new AbraFlexiClient(opts).createInvoice(payload)).rejects.toMatchObject({
      name: "AbraFlexiApiError",
      status: 401,
      retryable: false,
      message: "Abra Flexi HTTP 401",
    })
  })

  it("throws a retryable error on a network failure", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNRESET")) as unknown as typeof fetch
    await expect(new AbraFlexiClient(opts).createInvoice(payload)).rejects.toMatchObject({
      name: "AbraFlexiApiError",
      status: 0,
      retryable: true,
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test`
Expected: FAIL — `../abra-flexi-client` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
import type { AbraFlexiInvoicePayload, AbraFlexiInvoiceResult, AbraFlexiOptions } from "../types.js"
import { ABRA_FLEXI_VAT_RATE_CODE_BASIC } from "../types.js"

export class AbraFlexiApiError extends Error {
  readonly name = "AbraFlexiApiError"
  constructor(
    readonly status: number,
    message: string,
    readonly retryable = false
  ) {
    super(message)
  }
}

interface AbraFlexiWriteResult {
  id: string
  errors?: { message: string; code?: string }[]
}

interface AbraFlexiWriteResponse {
  winstrom?: {
    success?: boolean
    results?: AbraFlexiWriteResult[]
  }
}

export class AbraFlexiClient {
  private readonly base: string
  private readonly company: string
  private readonly auth: string
  private readonly fetchFn: typeof fetch

  constructor(opts: AbraFlexiOptions & { fetchFn?: typeof fetch }) {
    this.base = opts.baseUrl.replace(/\/+$/, "")
    this.company = opts.company
    this.auth = "Basic " + Buffer.from(`${opts.username}:${opts.password}`).toString("base64")
    this.fetchFn = opts.fetchFn ?? fetch
  }

  async createInvoice(payload: AbraFlexiInvoicePayload): Promise<AbraFlexiInvoiceResult> {
    const invoice: Record<string, unknown> = {
      id: `code:${payload.externalCode}`,
      typDokl: "code:FAKTURA",
      datVyd: payload.issueDate,
      splatnost: payload.dueDate,
      mena: `code:${payload.currency}`,
      nazFirma: payload.customer.name,
    }
    if (payload.customer.street) invoice.ulice = payload.customer.street
    if (payload.customer.city) invoice.mesto = payload.customer.city
    if (payload.customer.postalCode) invoice.psc = payload.customer.postalCode
    if (payload.customer.countryCode) invoice.stat = `code:${payload.customer.countryCode}`
    if (payload.customer.ico) invoice.ic = payload.customer.ico
    if (payload.customer.dic) invoice.dic = payload.customer.dic

    invoice.polozkyFaktury = payload.lines.map((line) => ({
      "faktura-vydana-polozka": {
        nazev: line.name,
        mnozMj: line.quantity,
        cenaMj: line.unitPrice,
        ...(line.vatRate != null
          ? { typCenyDphK: "typCeny.bezDph", typSzbDphK: ABRA_FLEXI_VAT_RATE_CODE_BASIC }
          : {}),
      },
    }))

    let res: Response
    try {
      res = await this.fetchFn(`${this.base}/c/${this.company}/faktura-vydana.json`, {
        method: "PUT",
        headers: { Authorization: this.auth, "Content-Type": "application/json" },
        body: JSON.stringify({ winstrom: { "faktura-vydana": invoice } }),
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
      throw new AbraFlexiApiError(
        res.status,
        "Abra Flexi: create response missing result id",
        false
      )
    }
    return { id: String(result.id), code: payload.externalCode }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test`
Expected: PASS (10 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/invoicing-abraflexi/src/core/abra-flexi-client.ts packages/invoicing-abraflexi/src/core/__tests__/abra-flexi-client.test.ts
git commit -s -m "feat(invoicing): Abra Flexi HTTP client (createInvoice)"
```

---

### Task 3: Order → invoice mapper

**Files:**

- Create: `packages/invoicing-abraflexi/src/core/order-to-invoice-mapper.ts`
- Create: `packages/invoicing-abraflexi/src/core/__tests__/order-to-invoice-mapper.test.ts`

**Interfaces:**

- Consumes: `isValidIco` from `@medusa-cz/shared`; `AbraFlexiInvoicePayload`, `AbraFlexiInvoiceLine`, `AbraFlexiCustomer`, `CZ_VAT_RATE_BASIC`, `ABRA_FLEXI_DEFAULT_DUE_DAYS` from `../types.js` (Task 1); `OrderDTO` from `@medusajs/framework/types`.
- Produces: `mapOrderToAbraFlexiInvoice(order: OrderDTO, config: { vatPayer: boolean }): AbraFlexiInvoicePayload`, consumed by Task 5 (workflow step 3).

This is the spec's "highest-value test surface" (§3, §7) — it's a pure function, fully testable without HTTP or a Medusa container.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest"
import { mapOrderToAbraFlexiInvoice } from "../order-to-invoice-mapper"
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

describe("mapOrderToAbraFlexiInvoice", () => {
  it("maps line items, currency, and issue/due dates", () => {
    const payload = mapOrderToAbraFlexiInvoice(baseOrder(), { vatPayer: false })
    expect(payload.currency).toBe("CZK")
    expect(payload.lines).toEqual([
      { name: "Tričko", quantity: 2, unitPrice: 299, vatRate: undefined },
      { name: "Doprava", quantity: 1, unitPrice: 79, vatRate: undefined },
    ])
    expect(payload.issueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(payload.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(new Date(payload.dueDate).getTime()).toBeGreaterThan(
      new Date(payload.issueDate).getTime()
    )
  })

  it("uses order id as the deterministic external code", () => {
    const payload = mapOrderToAbraFlexiInvoice(baseOrder({ id: "ord_456" }), { vatPayer: false })
    expect(payload.externalCode).toBe("order-ord_456")
  })

  it("maps the billing address into the customer, upper-casing the country code", () => {
    const payload = mapOrderToAbraFlexiInvoice(baseOrder(), { vatPayer: false })
    expect(payload.customer).toMatchObject({
      name: "Jan Novák",
      street: "Hlavní 1",
      city: "Praha",
      postalCode: "11000",
      countryCode: "CZ",
    })
  })

  it("falls back to the shipping address when billing address is missing", () => {
    const order = baseOrder({
      billing_address: undefined,
      shipping_address: {
        id: "addr_2",
        first_name: "Petra",
        last_name: "Svobodová",
        address_1: "Vedlejší 2",
        city: "Brno",
        postal_code: "60200",
        country_code: "cz",
        created_at: new Date(),
        updated_at: new Date(),
      },
    })
    const payload = mapOrderToAbraFlexiInvoice(order, { vatPayer: false })
    expect(payload.customer.name).toBe("Petra Svobodová")
    expect(payload.customer.city).toBe("Brno")
  })

  it("falls back to the order email when no address name is available", () => {
    const order = baseOrder({
      billing_address: undefined,
      shipping_address: undefined,
    })
    const payload = mapOrderToAbraFlexiInvoice(order, { vatPayer: false })
    expect(payload.customer.name).toBe("customer@example.com")
  })

  it("omits vatRate on every line when vatPayer is false", () => {
    const payload = mapOrderToAbraFlexiInvoice(baseOrder(), { vatPayer: false })
    expect(payload.lines.every((l) => l.vatRate === undefined)).toBe(true)
    expect(payload.vatPayer).toBe(false)
  })

  it("sets CZ_VAT_RATE_BASIC on every line when vatPayer is true", () => {
    const payload = mapOrderToAbraFlexiInvoice(baseOrder(), { vatPayer: true })
    expect(payload.lines.every((l) => l.vatRate === CZ_VAT_RATE_BASIC)).toBe(true)
    expect(payload.vatPayer).toBe(true)
  })

  it("includes a valid IČO from order metadata", () => {
    const order = baseOrder({ metadata: { ico: "25063677" } })
    const payload = mapOrderToAbraFlexiInvoice(order, { vatPayer: false })
    expect(payload.customer.ico).toBe("25063677")
  })

  it("omits an invalid IČO instead of blocking mapping", () => {
    const order = baseOrder({ metadata: { ico: "00000000" } })
    const payload = mapOrderToAbraFlexiInvoice(order, { vatPayer: false })
    expect(payload.customer.ico).toBeUndefined()
  })

  it("includes DIČ only alongside a valid IČO", () => {
    const withBoth = mapOrderToAbraFlexiInvoice(
      baseOrder({ metadata: { ico: "25063677", dic: "CZ25063677" } }),
      { vatPayer: false }
    )
    expect(withBoth.customer.dic).toBe("CZ25063677")

    const dicOnly = mapOrderToAbraFlexiInvoice(baseOrder({ metadata: { dic: "CZ25063677" } }), {
      vatPayer: false,
    })
    expect(dicOnly.customer.dic).toBeUndefined()
    expect(dicOnly.customer.ico).toBeUndefined()
  })

  it("omits ico/dic entirely when order has no metadata", () => {
    const payload = mapOrderToAbraFlexiInvoice(baseOrder({ metadata: null }), { vatPayer: false })
    expect(payload.customer.ico).toBeUndefined()
    expect(payload.customer.dic).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test`
Expected: FAIL — `../order-to-invoice-mapper` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
import { isValidIco } from "@medusa-cz/shared"
import type { OrderDTO } from "@medusajs/framework/types"
import { ABRA_FLEXI_DEFAULT_DUE_DAYS, CZ_VAT_RATE_BASIC } from "../types.js"
import type { AbraFlexiCustomer, AbraFlexiInvoiceLine, AbraFlexiInvoicePayload } from "../types.js"

export interface AbraFlexiMapperConfig {
  vatPayer: boolean
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function mapOrderToAbraFlexiInvoice(
  order: OrderDTO,
  config: AbraFlexiMapperConfig
): AbraFlexiInvoicePayload {
  const address = order.billing_address ?? order.shipping_address
  const nameFromAddress = [address?.first_name, address?.last_name].filter(Boolean).join(" ").trim()
  const customerName = nameFromAddress || address?.company || order.email || "Unknown customer"

  const customer: AbraFlexiCustomer = {
    name: customerName,
    street: address?.address_1 ?? undefined,
    city: address?.city ?? undefined,
    postalCode: address?.postal_code ?? undefined,
    countryCode: address?.country_code?.toUpperCase() ?? undefined,
  }

  const metadata = order.metadata as Record<string, unknown> | null | undefined
  const ico = typeof metadata?.ico === "string" ? metadata.ico : undefined
  if (ico && isValidIco(ico)) {
    customer.ico = ico
    const dic = typeof metadata?.dic === "string" ? metadata.dic : undefined
    if (dic) {
      customer.dic = dic
    }
  }

  const lines: AbraFlexiInvoiceLine[] = (order.items ?? []).map((item) => ({
    name: item.title,
    quantity: item.quantity,
    unitPrice: item.unit_price,
    vatRate: config.vatPayer ? CZ_VAT_RATE_BASIC : undefined,
  }))

  const issueDate = new Date()
  const dueDate = new Date(issueDate)
  dueDate.setDate(dueDate.getDate() + ABRA_FLEXI_DEFAULT_DUE_DAYS)

  return {
    externalCode: `order-${order.id}`,
    currency: order.currency_code.toUpperCase(),
    issueDate: isoDate(issueDate),
    dueDate: isoDate(dueDate),
    customer,
    lines,
    vatPayer: config.vatPayer,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test`
Expected: PASS (11 new tests, 21 total).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/invoicing-abraflexi/src/core/order-to-invoice-mapper.ts packages/invoicing-abraflexi/src/core/__tests__/order-to-invoice-mapper.test.ts
git commit -s -m "feat(invoicing): pure order-to-invoice mapper with VAT-payer/IČO handling"
```

---

### Task 4: Module registration

**Files:**

- Create: `packages/invoicing-abraflexi/src/modules/abra-flexi/index.ts`
- Create: `packages/invoicing-abraflexi/src/modules/abra-flexi/service.ts`
- Create: `packages/invoicing-abraflexi/src/modules/abra-flexi/__tests__/service.test.ts`
- Create: `packages/invoicing-abraflexi/src/index.ts`

**Interfaces:**

- Consumes: `AbraFlexiClient` from `../../core/abra-flexi-client.js` (Task 2); `AbraFlexiOptions` from `../../types.js` (Task 1).
- Produces: `ABRA_FLEXI_MODULE` (string constant, value `"abraFlexi"`), `AbraFlexiModuleService` (default export, `constructor(container, options: AbraFlexiOptions)`, `getOptions(): AbraFlexiOptions`, `getClient(): AbraFlexiClient`) — both consumed by Task 5 (workflow steps resolve the module from the container) and Task 9 (backend registration).

The module is deliberately thin — Abra Flexi itself is the source of truth (spec §1) — its only job is to receive `options` from `medusa-config.ts` (the same env-vars-in-config pattern already used by `payment-comgate` and `fulfillment-packeta`) and hand out a configured `AbraFlexiClient`. Constructor shape mirrors `PacketaProviderService`'s already-working `constructor(_container, options)` pattern (`packages/fulfillment-packeta/src/providers/packeta/service.ts:22-26`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import AbraFlexiModuleService from "../service"
import { AbraFlexiClient } from "../../../core/abra-flexi-client"

const options = {
  baseUrl: "https://demo.flexibee.eu:5434",
  company: "demo_company",
  username: "winstrom",
  password: "winstrom",
  vatPayer: false,
}

describe("AbraFlexiModuleService", () => {
  it("stores and returns the options it was constructed with", () => {
    const service = new AbraFlexiModuleService({} as never, options)
    expect(service.getOptions()).toEqual(options)
  })

  it("hands out a configured AbraFlexiClient", () => {
    const service = new AbraFlexiModuleService({} as never, options)
    expect(service.getClient()).toBeInstanceOf(AbraFlexiClient)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test`
Expected: FAIL — `../service` does not exist yet.

- [ ] **Step 3: Write `modules/abra-flexi/service.ts`**

```ts
import { MedusaService } from "@medusajs/framework/utils"
import { AbraFlexiClient } from "../../core/abra-flexi-client.js"
import type { AbraFlexiOptions } from "../../types.js"

class AbraFlexiModuleService extends MedusaService({}) {
  protected options_: AbraFlexiOptions

  constructor(_container: Record<string, unknown>, options: AbraFlexiOptions) {
    super(...arguments)
    this.options_ = options
  }

  getOptions(): AbraFlexiOptions {
    return this.options_
  }

  getClient(): AbraFlexiClient {
    return new AbraFlexiClient(this.options_)
  }
}

export default AbraFlexiModuleService
```

- [ ] **Step 4: Write `modules/abra-flexi/index.ts`**

```ts
import { Module } from "@medusajs/framework/utils"
import AbraFlexiModuleService from "./service.js"

export const ABRA_FLEXI_MODULE = "abraFlexi"

export default Module(ABRA_FLEXI_MODULE, {
  service: AbraFlexiModuleService,
})
```

- [ ] **Step 5: Write the package's top-level `src/index.ts` barrel**

```ts
export { default as AbraFlexiModuleService } from "./modules/abra-flexi/service.js"
export { ABRA_FLEXI_MODULE } from "./modules/abra-flexi/index.js"
export * from "./types.js"
```

(`createInvoiceInAbraFlexiWorkflow` is added to this barrel in Task 5, once it exists.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test`
Expected: PASS (2 new tests, 23 total).

- [ ] **Step 7: Typecheck and build**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi typecheck`
Run: `pnpm --filter @medusa-cz/invoicing-abraflexi build`
Expected: both succeed. (`build` exercises `medusa plugin:build`, the same command Comgate/Packeta already pass — if `MedusaService({}).constructor(...arguments)` has the wrong signature for this Medusa version, this is where it surfaces as a type or build error; if so, cross-check against `packages/payment-comgate/src/services/comgate-provider.ts`'s constructor shape, which is a `ModuleProvider` service using the identical pattern and is already known-working in this repo.)

- [ ] **Step 8: Commit**

```bash
git add packages/invoicing-abraflexi/src/modules packages/invoicing-abraflexi/src/index.ts
git commit -s -m "feat(invoicing): register the thin Abra Flexi module"
```

---

### Task 5: Workflow — `createInvoiceInAbraFlexiWorkflow`

**Files:**

- Create: `packages/invoicing-abraflexi/src/workflows/create-invoice-in-abra-flexi.ts`
- Create: `packages/invoicing-abraflexi/src/workflows/__tests__/create-invoice-in-abra-flexi.test.ts`
- Modify: `packages/invoicing-abraflexi/src/index.ts`

**Interfaces:**

- Consumes: `AbraFlexiApiError` from `../core/abra-flexi-client.js` (Task 2); `mapOrderToAbraFlexiInvoice` from `../core/order-to-invoice-mapper.js` (Task 3); `ABRA_FLEXI_MODULE`, `AbraFlexiModuleService` from `../modules/abra-flexi/index.js` / `service.js` (Task 4); `Modules`, `ContainerRegistrationKeys` from `@medusajs/framework/utils`; `createStep`, `createWorkflow`, `StepResponse`, `WorkflowResponse`, `when`, `transform` from `@medusajs/framework/workflows-sdk`; `OrderDTO` from `@medusajs/framework/types`.
- Produces: `CreateInvoiceInAbraFlexiInput` (`{ paymentId: string }`), `createInvoiceInAbraFlexiWorkflow` (default workflow export, invoked as `createInvoiceInAbraFlexiWorkflow(container).run({ input })`), plus the individually-exported step handler functions (`resolveOrderStepFn`, `mapOrderToPayloadStepFn`, `createInvoiceStepFn`, `persistInvoiceIdStepFn`) used directly by this task's own tests — consumed by Task 6 (subscriber).

API verified against the pinned `2.17.0` packages in `node_modules` (not assumed from memory, per `CLAUDE.md`):

- `container.resolve(Modules.PAYMENT).retrievePayment(id)` returns a `PaymentDTO` with `payment_collection_id` (`@medusajs/types` `payment/service.d.ts:365`, `payment/common.d.ts:287`).
- The order↔payment link is resolved the same way Medusa's own `capturePaymentWorkflow` does it (`@medusajs/core-flows` `payment/workflows/capture-payment.js`): query the `order_payment_collection` link entity, filtered by `payment_collection_id`, for `order.id` (and here, additional order fields in the same call).
- `container.resolve(ContainerRegistrationKeys.QUERY).graph({ entity, fields, filters })` returns `Promise<{ data: T[] }>` — always an array (`@medusajs/types` `modules-sdk/remote-query.d.ts:15-18`).
- `container.resolve(Modules.ORDER).updateOrders(orderId, { metadata })` returns `Promise<OrderDTO>` (`@medusajs/types` `order/service.d.ts:627`).
- `StepResponse.permanentFailure(message)` throws Medusa's own `PermanentStepFailureError` internally (`@medusajs/workflows-sdk` `helpers/step-response.js:126-131`) — this is what makes the orchestrator skip remaining retries and fail the step immediately (`@medusajs/orchestration` `transaction-orchestrator.js:842-846`: `isPermanent` forces `maxRetries` to `0` for that failure). This is the correct, documented way to implement "4xx does not retry" (spec §4 step 4, §6) — no need to import `PermanentStepFailureError` directly.
- `createStep({ name, maxRetries, retryInterval }, invokeFn)` — step-level retry config (`@medusajs/orchestration` `transaction/types.d.ts:36-48`); default `maxRetries` is `0` (no retry) if omitted, which is exactly what step 1 (data-integrity failure, no retry per spec §4 step 1) wants by _not_ setting it.
- `when(values, condition).then(resolver)` — the documented way to conditionally skip steps in a workflow composer (`@medusajs/workflows-sdk` `when.d.ts`; used verbatim by Medusa's own `capturePaymentWorkflow`).

Each step's core logic is exported as a plain named async function (`...StepFn`) and separately wrapped with `createStep`. `createStep`-wrapped functions can only run inside a real workflow execution, so this task's own unit tests call the `...StepFn` functions directly with a mocked `{ container }` — no `@medusajs/test-utils`/database needed for this level of test, matching the spec's ask ("idempotency guard, retry behavior, persisted metadata on success", not full end-to-end orchestration).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi } from "vitest"
import {
  resolveOrderStepFn,
  mapOrderToPayloadStepFn,
  createInvoiceStepFn,
  persistInvoiceIdStepFn,
} from "../create-invoice-in-abra-flexi"
import { AbraFlexiApiError } from "../../core/abra-flexi-client"
import type { OrderDTO } from "@medusajs/framework/types"

const order = {
  id: "ord_1",
  email: "c@example.com",
  currency_code: "czk",
  metadata: {},
  billing_address: { first_name: "Jan", last_name: "Novák" },
  items: [{ id: "li_1", title: "Tričko", quantity: 1, unit_price: 100 }],
} as unknown as OrderDTO

function mockContainer(overrides: Record<string, unknown> = {}) {
  return { resolve: vi.fn((key: string) => overrides[key]) }
}

describe("resolveOrderStepFn", () => {
  it("resolves the order via the payment's payment_collection_id", async () => {
    const payment = { id: "pay_1", payment_collection_id: "pay_col_1" }
    const paymentModuleService = { retrievePayment: vi.fn().mockResolvedValue(payment) }
    const query = { graph: vi.fn().mockResolvedValue({ data: [{ order }] }) }
    const container = mockContainer({ payment: paymentModuleService, query })

    const response = await resolveOrderStepFn({ paymentId: "pay_1" }, { container } as never)

    expect(paymentModuleService.retrievePayment).toHaveBeenCalledWith("pay_1")
    expect(query.graph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "order_payment_collection",
        filters: { payment_collection_id: "pay_col_1" },
      })
    )
    expect(response.output).toEqual({ order })
  })

  it("throws (no retry) when the payment has no linked order", async () => {
    const paymentModuleService = {
      retrievePayment: vi
        .fn()
        .mockResolvedValue({ id: "pay_1", payment_collection_id: "pay_col_1" }),
    }
    const query = { graph: vi.fn().mockResolvedValue({ data: [] }) }
    const container = mockContainer({ payment: paymentModuleService, query })

    await expect(
      resolveOrderStepFn({ paymentId: "pay_1" }, { container } as never)
    ).rejects.toThrow(/no order found/)
  })
})

describe("mapOrderToPayloadStepFn", () => {
  it("maps the order using the module's configured vatPayer flag", async () => {
    const abraFlexiModule = { getOptions: () => ({ vatPayer: true }) }
    const container = mockContainer({ abraFlexi: abraFlexiModule })

    const response = await mapOrderToPayloadStepFn({ order }, { container } as never)

    expect(response.output.vatPayer).toBe(true)
    expect(response.output.externalCode).toBe("order-ord_1")
  })
})

describe("createInvoiceStepFn", () => {
  const payload = {
    externalCode: "order-ord_1",
    currency: "CZK",
    issueDate: "2026-09-03",
    dueDate: "2026-09-17",
    customer: { name: "Jan Novák" },
    lines: [{ name: "Tričko", quantity: 1, unitPrice: 100 }],
    vatPayer: false,
  }

  it("returns the created invoice on success", async () => {
    const client = { createInvoice: vi.fn().mockResolvedValue({ id: "1", code: "order-ord_1" }) }
    const abraFlexiModule = { getClient: () => client }
    const container = mockContainer({ abraFlexi: abraFlexiModule })

    const response = await createInvoiceStepFn(payload, { container } as never)

    expect(response.output).toEqual({ id: "1", code: "order-ord_1" })
  })

  it("rethrows a retryable AbraFlexiApiError so the workflow engine retries", async () => {
    const client = {
      createInvoice: vi.fn().mockRejectedValue(new AbraFlexiApiError(500, "boom", true)),
    }
    const container = mockContainer({ abraFlexi: { getClient: () => client } })

    await expect(createInvoiceStepFn(payload, { container } as never)).rejects.toMatchObject({
      name: "AbraFlexiApiError",
      retryable: true,
    })
  })

  it("converts a non-retryable AbraFlexiApiError into a permanent step failure", async () => {
    const client = {
      createInvoice: vi.fn().mockRejectedValue(new AbraFlexiApiError(400, "bad payload", false)),
    }
    const container = mockContainer({ abraFlexi: { getClient: () => client } })

    await expect(createInvoiceStepFn(payload, { container } as never)).rejects.toMatchObject({
      // Medusa's PermanentStepFailureError sets its own .name to "PermanentStepFailure"
      // (no "Error" suffix) — verified in @medusajs/orchestration's errors.js.
      name: "PermanentStepFailure",
    })
  })
})

describe("persistInvoiceIdStepFn", () => {
  it("merges the invoice id/code into existing order metadata", async () => {
    const updateOrders = vi.fn().mockResolvedValue({})
    const container = mockContainer({ order: { updateOrders } })
    const orderWithMetadata = { ...order, metadata: { existing: "keep-me" } } as OrderDTO

    await persistInvoiceIdStepFn(
      { order: orderWithMetadata, invoice: { id: "1", code: "order-ord_1" } },
      { container } as never
    )

    expect(updateOrders).toHaveBeenCalledWith("ord_1", {
      metadata: {
        existing: "keep-me",
        abra_flexi_invoice_id: "1",
        abra_flexi_invoice_code: "order-ord_1",
      },
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test`
Expected: FAIL — `../create-invoice-in-abra-flexi` does not exist yet.

- [ ] **Step 3: Write the implementation**

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
// MedusaContainer specifically from the framework's MAIN entry (not the "/types"
// subpath) — only the main entry's export chain (index -> container -> types/container)
// pulls in the `declare module "@medusajs/types" { interface ModuleImplementations {...} }`
// augmentation that gives `container.resolve(Modules.PAYMENT)` etc. their real return
// types below. OrderDTO has no such requirement, so it comes from the lighter "/types" subpath.
import type { MedusaContainer } from "@medusajs/framework"
import type { OrderDTO } from "@medusajs/framework/types"
import { ABRA_FLEXI_MODULE } from "../modules/abra-flexi/index.js"
import type AbraFlexiModuleService from "../modules/abra-flexi/service.js"
import { AbraFlexiApiError } from "../core/abra-flexi-client.js"
import { mapOrderToAbraFlexiInvoice } from "../core/order-to-invoice-mapper.js"
import type { AbraFlexiInvoicePayload, AbraFlexiInvoiceResult } from "../types.js"

export interface CreateInvoiceInAbraFlexiInput {
  paymentId: string
}

interface StepCtx {
  container: MedusaContainer
}

interface ResolvedOrder {
  order: OrderDTO
}

export async function resolveOrderStepFn(
  input: CreateInvoiceInAbraFlexiInput,
  { container }: StepCtx
): Promise<StepResponse<ResolvedOrder>> {
  const paymentModuleService = container.resolve(Modules.PAYMENT)
  const payment = await paymentModuleService.retrievePayment(input.paymentId)

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order_payment_collection",
    fields: [
      "order.id",
      "order.email",
      "order.currency_code",
      "order.metadata",
      "order.items.title",
      "order.items.quantity",
      "order.items.unit_price",
      "order.shipping_address.*",
      "order.billing_address.*",
    ],
    filters: { payment_collection_id: payment.payment_collection_id },
  })

  const order = data[0]?.order as OrderDTO | undefined
  if (!order) {
    throw new Error(
      `Abra Flexi: no order found for payment "${input.paymentId}" (payment_collection_id "${payment.payment_collection_id}")`
    )
  }
  return new StepResponse<ResolvedOrder>({ order })
}
const resolveOrderStep = createStep("resolve-order-from-payment", resolveOrderStepFn)

export async function mapOrderToPayloadStepFn(
  { order }: ResolvedOrder,
  { container }: StepCtx
): Promise<StepResponse<AbraFlexiInvoicePayload>> {
  const abraFlexi = container.resolve<AbraFlexiModuleService>(ABRA_FLEXI_MODULE)
  const payload = mapOrderToAbraFlexiInvoice(order, { vatPayer: !!abraFlexi.getOptions().vatPayer })
  return new StepResponse(payload)
}
const mapOrderToPayloadStep = createStep(
  { name: "map-order-to-abra-flexi-payload" },
  mapOrderToPayloadStepFn
)

export async function createInvoiceStepFn(
  payload: AbraFlexiInvoicePayload,
  { container }: StepCtx
): Promise<StepResponse<AbraFlexiInvoiceResult>> {
  const abraFlexi = container.resolve<AbraFlexiModuleService>(ABRA_FLEXI_MODULE)
  try {
    const invoice = await abraFlexi.getClient().createInvoice(payload)
    return new StepResponse(invoice)
  } catch (e) {
    if (e instanceof AbraFlexiApiError && !e.retryable) {
      return StepResponse.permanentFailure(e.message)
    }
    throw e
  }
}
const createInvoiceStep = createStep(
  { name: "create-invoice-in-abra-flexi", maxRetries: 3, retryInterval: 30 },
  createInvoiceStepFn
)

export async function persistInvoiceIdStepFn(
  input: { order: OrderDTO; invoice: AbraFlexiInvoiceResult },
  { container }: StepCtx
): Promise<StepResponse<AbraFlexiInvoiceResult>> {
  const orderModuleService = container.resolve(Modules.ORDER)
  await orderModuleService.updateOrders(input.order.id, {
    metadata: {
      ...(input.order.metadata ?? {}),
      abra_flexi_invoice_id: input.invoice.id,
      abra_flexi_invoice_code: input.invoice.code,
    },
  })
  return new StepResponse(input.invoice)
}
const persistInvoiceIdStep = createStep("persist-abra-flexi-invoice-id", persistInvoiceIdStepFn)

export const createInvoiceInAbraFlexiWorkflow = createWorkflow(
  "create-invoice-in-abra-flexi",
  (input: CreateInvoiceInAbraFlexiInput) => {
    const resolved = resolveOrderStep(input)

    const existingInvoiceId = transform(
      { resolved },
      ({ resolved }) => resolved.order.metadata?.abra_flexi_invoice_id as string | undefined
    )

    const newInvoice = when(
      { existingInvoiceId },
      ({ existingInvoiceId }) => !existingInvoiceId
    ).then(() => {
      const payload = mapOrderToPayloadStep(resolved)
      const created = createInvoiceStep(payload)
      return persistInvoiceIdStep({ order: resolved.order, invoice: created })
    })

    const result = transform(
      { resolved, existingInvoiceId, newInvoice },
      ({ resolved, existingInvoiceId, newInvoice }) =>
        newInvoice ?? {
          id: existingInvoiceId as string,
          code: resolved.order.metadata?.abra_flexi_invoice_code as string,
        }
    )

    return new WorkflowResponse(result)
  }
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test`
Expected: PASS (7 new tests, 30 total).

- [ ] **Step 5: Add the workflow to the package barrel**

In `packages/invoicing-abraflexi/src/index.ts`, add:

```ts
export {
  createInvoiceInAbraFlexiWorkflow,
  type CreateInvoiceInAbraFlexiInput,
} from "./workflows/create-invoice-in-abra-flexi.js"
```

- [ ] **Step 6: Typecheck and build**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi typecheck`
Run: `pnpm --filter @medusa-cz/invoicing-abraflexi build`
Expected: both succeed. `container.resolve(Modules.PAYMENT)` and `container.resolve(Modules.ORDER)` should infer as `IPaymentModuleService`/`IOrderModuleService` (and `container.resolve(ContainerRegistrationKeys.QUERY)` as `RemoteQueryFunction`) automatically — `@medusajs/framework`'s own `dist/types/container.d.ts` declares a `declare module "@medusajs/types" { interface ModuleImplementations { [Modules.PAYMENT]: IPaymentModuleService; [Modules.ORDER]: IOrderModuleService; [ContainerRegistrationKeys.QUERY]: Omit<RemoteQueryFunction, symbol>; ... } }` augmentation that `MedusaContainer<Cradle>`'s `resolve<K extends keyof Cradle>(key: K)` overload picks up automatically once anything imports from `@medusajs/framework/types` (as this file already does for `MedusaContainer`). If it doesn't for some reason (e.g. a TS project-reference quirk), fall back to an explicit generic the same way `ABRA_FLEXI_MODULE` already needs one (custom modules aren't in that global map): `container.resolve<IPaymentModuleService>(Modules.PAYMENT)`, importing the type from `@medusajs/framework/types`.

- [ ] **Step 7: Commit**

```bash
git add packages/invoicing-abraflexi/src/workflows packages/invoicing-abraflexi/src/index.ts
git commit -s -m "feat(invoicing): createInvoiceInAbraFlexiWorkflow (resolve, idempotency guard, map, create, persist)"
```

---

### Task 6: Subscriber

**Files:**

- Create: `packages/invoicing-abraflexi/src/subscribers/payment-captured.ts`
- Create: `packages/invoicing-abraflexi/src/subscribers/__tests__/payment-captured.test.ts`

**Interfaces:**

- Consumes: `createInvoiceInAbraFlexiWorkflow` from `../workflows/create-invoice-in-abra-flexi.js` (Task 5); `SubscriberArgs`, `SubscriberConfig` from `@medusajs/framework`.
- Produces: default export (the subscriber handler) and `config` (`SubscriberConfig`), loaded automatically by Medusa's subscriber loader once the module is registered (Task 9) — nothing else in this package imports from this file.

Event name verified: `PaymentEvents.CAPTURED === "payment.captured"` (`@medusajs/utils` `core-flows/events.d.ts:922`), payload `{ id }` = the **payment** id (per `@medusajs/core-flows`'s `capturePaymentWorkflow`: `emitEventStep({ eventName: PaymentEvents.CAPTURED, data: { id: payment.id } })`) — matches spec §"Decisions" exactly. Thin pass-through, matching the repo's existing subscriber style (`apps/backend/src/subscribers/*.ts`, `packages/invoicing-fakturoid`'s deleted `order-placed.ts`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest"

vi.mock("../../workflows/create-invoice-in-abra-flexi", () => ({
  createInvoiceInAbraFlexiWorkflow: vi.fn(),
}))

import abraFlexiPaymentCapturedHandler, { config } from "../payment-captured"
import { createInvoiceInAbraFlexiWorkflow } from "../../workflows/create-invoice-in-abra-flexi"

describe("payment-captured subscriber", () => {
  it("listens on payment.captured", () => {
    expect(config.event).toBe("payment.captured")
  })

  it("runs createInvoiceInAbraFlexiWorkflow with the payment id from the event", async () => {
    const run = vi.fn().mockResolvedValue({ result: { id: "1", code: "order-ord_1" } })
    ;(createInvoiceInAbraFlexiWorkflow as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      run,
    })
    const container = {} as never

    await abraFlexiPaymentCapturedHandler({
      event: { data: { id: "pay_1" }, name: "payment.captured" },
      container,
      pluginOptions: {},
    } as never)

    expect(createInvoiceInAbraFlexiWorkflow).toHaveBeenCalledWith(container)
    expect(run).toHaveBeenCalledWith({ input: { paymentId: "pay_1" } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test`
Expected: FAIL — `../payment-captured` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { createInvoiceInAbraFlexiWorkflow } from "../workflows/create-invoice-in-abra-flexi.js"

export default async function abraFlexiPaymentCapturedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>): Promise<void> {
  await createInvoiceInAbraFlexiWorkflow(container).run({ input: { paymentId: data.id } })
}

export const config: SubscriberConfig = {
  event: "payment.captured",
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test`
Expected: PASS (2 new tests, 32 total).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/invoicing-abraflexi/src/subscribers
git commit -s -m "feat(invoicing): payment.captured subscriber runs the invoice workflow"
```

---

### Task 7: Opt-in live integration suite

**Files:**

- Create: `packages/invoicing-abraflexi/src/__tests__/integration/abra-flexi-sandbox.test.ts`

**Interfaces:**

- Consumes: `AbraFlexiClient` from `../../core/abra-flexi-client.js` (Task 2).
- Produces: nothing consumed elsewhere — this suite only runs via `pnpm --filter @medusa-cz/invoicing-abraflexi test:integration`, and only when live credentials are set. This is also the real verification gate for the wire-format field names flagged as lower-confidence in the Global Constraints section — run it against a sandbox Abra Flexi instance at least once before enabling `ABRA_FLEXI_*` in production.

Mirrors `packages/payment-comgate/src/__tests__/integration/comgate-sandbox.test.ts`'s `describe.skip` gating pattern exactly.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest"
import { AbraFlexiClient } from "../../core/abra-flexi-client"

const baseUrl = process.env.ABRA_FLEXI_BASE_URL
const company = process.env.ABRA_FLEXI_COMPANY
const username = process.env.ABRA_FLEXI_USERNAME
const password = process.env.ABRA_FLEXI_PASSWORD
const run = baseUrl && company && username && password ? describe : describe.skip

run("Abra Flexi sandbox (live)", () => {
  const client = new AbraFlexiClient({
    baseUrl: baseUrl!,
    company: company!,
    username: username!,
    password: password!,
  })

  it("creates a test invoice and returns its id/code", async () => {
    const result = await client.createInvoice({
      externalCode: `sandbox-test-${Date.now()}`,
      currency: "CZK",
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      customer: { name: "Sandbox Test Customer", countryCode: "CZ" },
      lines: [{ name: "Integration test item", quantity: 1, unitPrice: 1 }],
      vatPayer: false,
    })
    expect(result.id).toBeTruthy()
    expect(result.code).toMatch(/^sandbox-test-/)
  })
})
```

- [ ] **Step 2: Run; verify it's skipped by default**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test`
Expected: PASS, unaffected (this file lives under `src/__tests__/integration/`, excluded by `vitest.config.ts`'s `exclude`).
Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test:integration`
Expected: 1 test **skipped** (no `ABRA_FLEXI_*` env vars set in this environment) — this is the expected default-CI outcome; it never fires a real invoice unless someone deliberately sets live credentials.

- [ ] **Step 3: Commit**

```bash
git add packages/invoicing-abraflexi/src/__tests__/integration/abra-flexi-sandbox.test.ts
git commit -s -m "test(invoicing): opt-in Abra Flexi sandbox integration suite"
```

---

### Task 8: README

**Files:**

- Create: `packages/invoicing-abraflexi/README.md`

- [ ] **Step 1: Write the README**

````md
# @medusa-cz/invoicing-abraflexi

Abra Flexi invoicing for MedusaJS 2.0 (medusa-cz). Listens for `payment.captured`
and issues a Czech sales invoice in Abra Flexi via a durable, retried Medusa
workflow. Idempotent — a second capture on an already-invoiced order is a no-op.

## Install

```bash
pnpm add @medusa-cz/invoicing-abraflexi
```

## Register (`medusa-config.ts`)

```ts
modules: [
  {
    resolve: "@medusa-cz/invoicing-abraflexi/modules/abra-flexi",
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
3. If `order.metadata.abra_flexi_invoice_id` is already set, stop — no duplicate invoice.
4. Map the order to an Abra Flexi invoice payload (line items, customer, optional IČO/DIČ).
5. Create the invoice in Abra Flexi. Transient failures (network, 5xx) are retried
   automatically by Medusa's workflow engine; 4xx failures (bad payload, auth) fail
   the workflow run visibly instead of retrying — check Medusa's workflow execution
   log for manual reconciliation.
6. Persist `abra_flexi_invoice_id` / `abra_flexi_invoice_code` onto `order.metadata`.

## Known gaps (by design, deferred)

- **Reduced/mixed VAT rates.** Only the basic 21% rate is supported, and only once
  `ABRA_FLEXI_VAT_PAYER=true`. The business is currently a non-VAT-payer, so this
  doesn't apply yet — revisit when it does.
- **Storefront IČO/DIČ capture.** The mapper reads `order.metadata.ico` /
  `order.metadata.dic` if present, but nothing in the storefront sets them yet
  (B2C only, today). Small fast-follow once B2B checkout is needed.
- **Payment status sync, credit notes, general ledger.** Separate sub-projects
  (2-4) of the Abra Flexi milestone — not built here.
- **Wire-format field names.** `datVyd`/`splatnost`/`mena`/customer fields are
  verified against Abra Flexi's public docs; the line-items shape
  (`polozkyFaktury`/`faktura-vydana-polozka`) is corroborated by a community
  reference but has no first-party JSON example for this evidence type. Run
  `pnpm --filter @medusa-cz/invoicing-abraflexi test:integration` against a real
  sandbox instance (set `ABRA_FLEXI_*` env vars) before relying on this in
  production, and fix up field names here if the sandbox disagrees.

## Manual acceptance (once registered with real credentials)

1. Place and pay for a test order (Comgate/GoPay sandbox, or manual capture via
   the admin API).
2. Confirm an invoice appears in Abra Flexi with the right customer, line items,
   and total.
3. Confirm `order.metadata.abra_flexi_invoice_id` is set on the Medusa order.
4. Trigger a second `payment.captured` for the same order (e.g. a partial second
   capture) and confirm no duplicate invoice is created.
````

- [ ] **Step 2: Commit**

```bash
git add packages/invoicing-abraflexi/README.md
git commit -s -m "docs(invoicing): README for invoicing-abraflexi"
```

---

### Task 9: Backend registration

**Files:**

- Modify: `apps/backend/medusa-config.ts`
- Modify: `apps/backend/package.json`

**Interfaces:**

- Consumes: the `@medusa-cz/invoicing-abraflexi/modules/abra-flexi` module resolve path (Task 4's `exports` map in `package.json`).

Only runs once the full package gate is green (Global Constraints) — mirrors the Packeta M2a plan's Task 12 (register provider + env vars, deploy is a separate later step). This task registers the module against **dummy/placeholder** env values by default (nothing is live until real `ABRA_FLEXI_*` credentials are set on the server) — same "neutered" pattern already used for Packeta.

- [ ] **Step 1: Run the full package gate one more time before touching the backend**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test`
Run: `pnpm --filter @medusa-cz/invoicing-abraflexi typecheck`
Run: `pnpm --filter @medusa-cz/invoicing-abraflexi build`
Expected: all green (32 tests passing, no type errors, build succeeds).

- [ ] **Step 2: Add the workspace dependency**

In `apps/backend/package.json`, in `"dependencies"`, add (alphabetically, next to the existing `@medusa-cz/*` entries):

```json
"@medusa-cz/invoicing-abraflexi": "workspace:*",
```

- [ ] **Step 3: Register the module in `medusa-config.ts`**

In `apps/backend/medusa-config.ts`, inside the `modules: [` array (after the existing `@medusajs/medusa/fulfillment` entry, before the Redis-conditional block), add:

```ts
    {
      resolve: "@medusa-cz/invoicing-abraflexi/modules/abra-flexi",
      options: {
        baseUrl: process.env.ABRA_FLEXI_BASE_URL,
        company: process.env.ABRA_FLEXI_COMPANY,
        username: process.env.ABRA_FLEXI_USERNAME,
        password: process.env.ABRA_FLEXI_PASSWORD,
        vatPayer: process.env.ABRA_FLEXI_VAT_PAYER === "true",
      },
    },
```

- [ ] **Step 4: Add the env var names to `.env.template`**

In `apps/backend/.env.template`, add (near the existing `PACKETA_*` block, for consistency):

```
ABRA_FLEXI_BASE_URL=
ABRA_FLEXI_COMPANY=
ABRA_FLEXI_USERNAME=
ABRA_FLEXI_PASSWORD=
ABRA_FLEXI_VAT_PAYER=false
```

Leave the values blank (or `false` for the one boolean default) — this is a template, not real credentials. If the sandbox/local `.env` used for development needs values too, set dummy/placeholder ones there directly (never real credentials in a file this plan or its executor commits) — same handling as the Packeta rollout.

- [ ] **Step 5: Install and verify the backend still builds**

Run: `pnpm install` (links the new workspace dependency)
Run: `pnpm --filter backend typecheck`
Run: `pnpm --filter backend build`
Expected: both succeed. If `medusa-config.ts`'s module resolution fails because the exports map path is wrong, double check `packages/invoicing-abraflexi/package.json`'s `exports["./modules/*"]` from Task 1 Step 2 matches the resolve path used here exactly (`@medusa-cz/invoicing-abraflexi/modules/abra-flexi` → `.medusa/server/src/modules/abra-flexi/index.js`).

- [ ] **Step 6: Run the whole-repo gate**

Run: `pnpm typecheck`
Run: `pnpm lint`
Run: `pnpm test`
Run: `pnpm format:check` (run `pnpm format` first if it fails, then re-check)
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/medusa-config.ts apps/backend/package.json apps/backend/.env.template pnpm-lock.yaml
git commit -s -m "feat(demo): register Abra Flexi invoicing module (dummy creds, not yet live)"
```

- [ ] **Step 8: Push**

```bash
git push origin master
```

(Per `CLAUDE.md`: solo-dev workflow, no feature branches/PRs — commit straight to `master`, push once local checks are green.)

---

## Self-review notes

- **Spec coverage:** §1 package structure → Task 1/4/5/6. §2 client → Task 2. §3 mapping → Task 3. §4 workflow (all 5 steps, idempotency, no compensation) → Task 5. §5 subscriber → Task 6. §6 error handling (retry vs permanent failure) → Task 5 (`createInvoiceStepFn`) + Task 2 (`retryable` flag). §7 testing (all four listed test files + opt-in live suite) → Tasks 2, 3, 5, 7. §8 out-of-scope items are not built anywhere in this plan (verified: no payment-sync, credit-note, general-ledger, or storefront IČO/DIČ code appears in any task). Acceptance summary's "module registered ... behind real env credentials (server-side rollout is a separate, later step)" → Task 9 registers with env-var plumbing but does not set real credentials or deploy.
- **Placeholder scan:** no task contains "TBD"/"add error handling"/"similar to Task N" — every step has literal code or an exact command.
- **Type consistency:** `AbraFlexiOptions`, `AbraFlexiCustomer`, `AbraFlexiInvoiceLine`, `AbraFlexiInvoicePayload`, `AbraFlexiInvoiceResult` (Task 1) are used with identical field names across Tasks 2 (client), 3 (mapper), 4 (service), 5 (workflow), 7 (live suite). `ABRA_FLEXI_MODULE` (Task 4) matches the container-resolve key used in Task 5. `createInvoiceInAbraFlexiWorkflow`/`CreateInvoiceInAbraFlexiInput` (Task 5) match the subscriber's usage in Task 6. `resolveOrderStepFn`/`mapOrderToPayloadStepFn`/`createInvoiceStepFn`/`persistInvoiceIdStepFn` names are consistent between their definition and their test imports in Task 5.
