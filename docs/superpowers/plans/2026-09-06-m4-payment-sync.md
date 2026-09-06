# Abra Flexi Payment Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Medusa payment is captured, mark the Abra Flexi invoice that `createInvoiceInAbraFlexiWorkflow` already created for it as paid — closing the gap where invoices sit as issued/unpaid in Abra Flexi forever, regardless of real payment state in Medusa.

**Architecture:** A new `recordPaymentInAbraFlexiWorkflow`, same step-based shape as the existing `createInvoiceInAbraFlexiWorkflow` (durable, retried via the already-configured `workflow-engine-redis`). The existing `payment.captured` subscriber is extended to run it **sequentially after** invoice creation, in the same handler — guarantees the invoice exists first with no polling or race condition, and a failed invoice creation naturally short-circuits before any payment gets recorded. The client writes a direct `stavUhrK` (payment-status) field on the existing invoice via the same `faktura-vydana.json` endpoint `createInvoice` already uses — no new evidence type, no bank-account entity. Idempotency is tracked **per payment id** (`order.metadata.abra_flexi_recorded_payment_ids: string[]`), not a single per-invoice boolean, so a genuine second capture on the same order (Medusa's existing split-tender case) is correctly recorded rather than silently dropped.

**Tech Stack:** TypeScript, Medusa v2.17.0 workflows-sdk (`createStep`/`createWorkflow`/`StepResponse`/`WorkflowResponse`/`when`/`transform`), vitest, native `fetch`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-06-m4-payment-sync-design.md` — this plan implements that spec in full. Supporting research: `docs/superpowers/research/2026-09-06-abra-flexi-payment-api-verification.md` (the Option A vs. B decision).

## Global Constraints

- Node >=20, TypeScript strict mode (`tsconfig.base.json`: `strict: true`, `noUncheckedIndexedAccess: true`) — every array/record index access needs a null check or non-null assertion.
- Medusa packages pinned to **2.17.0** across the monorepo — nothing in this plan changes any package's dependency versions.
- TDD per `CLAUDE.md`: RED → GREEN → REFACTOR, one behavior per test, matching this package's existing suites' style and the mocked-`fetch` pattern in `abra-flexi-client.test.ts`.
- Conventional Commits, `git commit -s` (DCO sign-off) on every commit.
- Package test gate (`pnpm --filter @medusa-cz/invoicing-abraflexi test`, `typecheck`, `build`) must be green before the subscriber wiring in Task 4 is considered done — no new module registration is needed in `apps/backend/medusa-config.ts` (the module is already registered from sub-project 1).
- The DB-backed idempotency integration test (Task 5) needs a real reachable Postgres (`DB_HOST`/`DB_USERNAME`/`DB_PASSWORD`/`DB_PORT`, `pg-god` devDependency already present, the `localhost`-not-`127.0.0.1` SSL trap already documented) — same requirements as the existing `create-invoice-idempotency.test.ts`, not repeated per-task below; see that file's header comment for the full account.
- `stavUhrK: "code:stavUhr.paidRucne"` (Option A) is this session's verified decision, not a guess — see the spec §1 and the research doc for why, and why swapping to Option B later only touches `AbraFlexiClient.recordPayment`'s internals.

---

## 1. File structure

```
packages/invoicing-abraflexi/
  README.md                                          # updated (Task 4)
  src/
    types.ts                                          # + AbraFlexiRecordPaymentPayload/Result, status code const (Task 2)
    core/
      order-to-invoice-mapper.ts                       # + exported abraFlexiExternalCodeForOrder helper (Task 1)
      __tests__/
        order-to-invoice-mapper.test.ts                # + helper test (Task 1)
      abra-flexi-client.ts                             # + recordPayment() (Task 2)
      __tests__/
        abra-flexi-client.test.ts                      # + recordPayment tests (Task 2)
    workflows/
      create-invoice-in-abra-flexi.ts                  # unchanged (resolveOrderStepFn reused, Task 3)
      record-payment-in-abra-flexi.ts                  # new: 3-step workflow (Task 3)
      __tests__/
        record-payment-in-abra-flexi.test.ts           # new (Task 3)
    subscribers/
      payment-captured.ts                              # extended: chain both workflows (Task 4)
      __tests__/
        payment-captured.test.ts                       # extended (Task 4)
    __tests__/
      integration/
        idempotency/
          mock-abra-flexi-server.ts                    # extended: split create/record-payment counters (Task 5)
          record-payment-idempotency.test.ts            # new (Task 5)
        abra-flexi-sandbox.test.ts                      # extended: live recordPayment case (Task 6)
```

---

### Task 1: Shared `externalCode` helper

**Files:**
- Modify: `packages/invoicing-abraflexi/src/core/order-to-invoice-mapper.ts`
- Modify: `packages/invoicing-abraflexi/src/core/__tests__/order-to-invoice-mapper.test.ts`

**Interfaces:**
- Produces (used by Task 3): `abraFlexiExternalCodeForOrder(orderId: string): string`, exported from `order-to-invoice-mapper.ts`.

Today `mapOrderToAbraFlexiInvoice` inlines `` `order-${order.id}` `` directly (line 65). The new payment-recording workflow needs to derive the exact same string from an order id (it addresses the same invoice record, not a fresh one) — duplicating the template literal in two files would let them silently drift if the format ever changes. Extracting it once, now, while it's a one-line change, avoids that.

- [ ] **Step 1: Write the failing test**

Add to `packages/invoicing-abraflexi/src/core/__tests__/order-to-invoice-mapper.test.ts`, after the existing `import` lines:

```ts
import { mapOrderToAbraFlexiInvoice, abraFlexiExternalCodeForOrder } from "../order-to-invoice-mapper"
```

(replacing the existing `import { mapOrderToAbraFlexiInvoice } from "../order-to-invoice-mapper"` line)

Add this new `describe` block anywhere at the top level of the file (e.g. right after the closing `})` of the existing `describe("mapOrderToAbraFlexiInvoice", ...)` block):

```ts
describe("abraFlexiExternalCodeForOrder", () => {
  it("prefixes the order id with 'order-'", () => {
    expect(abraFlexiExternalCodeForOrder("ord_123")).toBe("order-ord_123")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test -- order-to-invoice-mapper`
Expected: FAIL — `abraFlexiExternalCodeForOrder` is not exported from `../order-to-invoice-mapper`.

- [ ] **Step 3: Implement the helper and use it internally**

In `packages/invoicing-abraflexi/src/core/order-to-invoice-mapper.ts`, add this exported function (placed above `mapOrderToAbraFlexiInvoice`):

```ts
export function abraFlexiExternalCodeForOrder(orderId: string): string {
  return `order-${orderId}`
}
```

Then change the `return` statement inside `mapOrderToAbraFlexiInvoice` (currently `externalCode: \`order-${order.id}\`,`) to:

```ts
    externalCode: abraFlexiExternalCodeForOrder(order.id),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test -- order-to-invoice-mapper`
Expected: PASS — including the pre-existing test that asserts `payload.externalCode` (unchanged behavior, now sourced from the helper).

- [ ] **Step 5: Commit**

```bash
git add packages/invoicing-abraflexi/src/core/order-to-invoice-mapper.ts packages/invoicing-abraflexi/src/core/__tests__/order-to-invoice-mapper.test.ts
git commit -s -m "refactor(invoicing-abraflexi): extract abraFlexiExternalCodeForOrder helper"
```

---

### Task 2: `AbraFlexiClient.recordPayment`

**Files:**
- Modify: `packages/invoicing-abraflexi/src/types.ts`
- Modify: `packages/invoicing-abraflexi/src/core/abra-flexi-client.ts`
- Modify: `packages/invoicing-abraflexi/src/core/__tests__/abra-flexi-client.test.ts`

**Interfaces:**
- Consumes: none new.
- Produces (used by Task 3): `AbraFlexiClient.recordPayment(payload: AbraFlexiRecordPaymentPayload): Promise<AbraFlexiRecordPaymentResult>`; types `AbraFlexiRecordPaymentPayload { invoiceExternalCode: string }`, `AbraFlexiRecordPaymentResult { id: string }`; constant `ABRA_FLEXI_PAYMENT_STATUS_CODE_PAID_MANUALLY`.

- [ ] **Step 1: Add the new types and constant**

Add to `packages/invoicing-abraflexi/src/types.ts`, after the existing `AbraFlexiInvoiceResult` interface:

```ts
export interface AbraFlexiRecordPaymentPayload {
  /** matches AbraFlexiInvoicePayload.externalCode for the invoice being marked paid */
  invoiceExternalCode: string
}

export interface AbraFlexiRecordPaymentResult {
  id: string
}
```

Add after the existing `ABRA_FLEXI_VAT_RATE_CODE_BASIC` constant:

```ts
// Abra Flexi's manual-payment-status code (winstrom `stavUhrK` field on
// faktura-vydana), written directly on the invoice via the same
// faktura-vydana.json endpoint createInvoice() already uses. Chosen over
// creating a linked `banka` bank-movement record (also a valid, documented
// approach) because this business doesn't manage real bank/cash records in
// Abra Flexi yet -- see
// docs/superpowers/research/2026-09-06-abra-flexi-payment-api-verification.md
// for both options and why. Swapping to a `banka`-based implementation later
// only touches AbraFlexiClient.recordPayment's internals below, not the
// workflow that calls it.
export const ABRA_FLEXI_PAYMENT_STATUS_CODE_PAID_MANUALLY = "stavUhr.paidRucne"
```

- [ ] **Step 2: Write the failing tests**

Add to `packages/invoicing-abraflexi/src/core/__tests__/abra-flexi-client.test.ts`. First, update the import line at the top of the file:

```ts
import { ABRA_FLEXI_VAT_RATE_CODE_BASIC, ABRA_FLEXI_PAYMENT_STATUS_CODE_PAID_MANUALLY } from "../../types"
```

(replacing the existing `import { ABRA_FLEXI_VAT_RATE_CODE_BASIC } from "../../types"` line)

Then add this new `describe` block at the end of the file, after the closing `})` of `describe("AbraFlexiClient.createInvoice", ...)`:

```ts
describe("AbraFlexiClient.recordPayment", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockFetchFn = null
  })

  it("PUTs to the faktura-vydana collection URL with Basic auth", async () => {
    mockFetchOnce(200, { winstrom: { success: true, results: [{ id: "1" }] } })
    const client = new AbraFlexiClient(opts)
    await client.recordPayment({ invoiceExternalCode: "order-ord_123" })
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(call[0]).toBe("https://demo.flexibee.eu:5434/c/demo_company/faktura-vydana.json")
    expect(call[1].method).toBe("PUT")
    expect(call[1].headers.Authorization).toBe(
      "Basic " + Buffer.from("winstrom:winstrom").toString("base64")
    )
    expect(call[1].headers["Content-Type"]).toBe("application/json")
  })

  it("sends only the invoice id and the manual-paid status code", async () => {
    mockFetchOnce(200, { winstrom: { success: true, results: [{ id: "1" }] } })
    await new AbraFlexiClient(opts).recordPayment({ invoiceExternalCode: "order-ord_123" })
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    const body = JSON.parse(call[1].body)
    expect(body.winstrom["faktura-vydana"]).toEqual({
      id: "code:order-ord_123",
      stavUhrK: `code:${ABRA_FLEXI_PAYMENT_STATUS_CODE_PAID_MANUALLY}`,
    })
  })

  it("resolves with the numeric id", async () => {
    mockFetchOnce(200, { winstrom: { success: true, results: [{ id: "42" }] } })
    const result = await new AbraFlexiClient(opts).recordPayment({
      invoiceExternalCode: "order-ord_123",
    })
    expect(result).toEqual({ id: "42" })
  })

  it("throws a retryable AbraFlexiApiError on a 5xx response", async () => {
    mockFetchOnce(500, {
      winstrom: { success: false, results: [{ id: "0", errors: [{ message: "boom" }] }] },
    })
    await expect(
      new AbraFlexiClient(opts).recordPayment({ invoiceExternalCode: "order-ord_123" })
    ).rejects.toMatchObject({ name: "AbraFlexiApiError", status: 500, retryable: true, message: "boom" })
  })

  it("throws a non-retryable AbraFlexiApiError on a 404 response (invoice not found)", async () => {
    mockFetchOnce(404, {
      winstrom: {
        success: false,
        results: [{ id: "0", errors: [{ message: "Record not found" }] }],
      },
    })
    await expect(
      new AbraFlexiClient(opts).recordPayment({ invoiceExternalCode: "order-ord_123" })
    ).rejects.toMatchObject({
      name: "AbraFlexiApiError",
      status: 404,
      retryable: false,
      message: "Record not found",
    })
  })

  it("throws a retryable error on a network failure", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNRESET")) as unknown as typeof fetch
    await expect(
      new AbraFlexiClient(opts).recordPayment({ invoiceExternalCode: "order-ord_123" })
    ).rejects.toMatchObject({ name: "AbraFlexiApiError", status: 0, retryable: true })
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test -- abra-flexi-client`
Expected: FAIL — `client.recordPayment is not a function`.

- [ ] **Step 4: Implement `recordPayment`**

Add to `packages/invoicing-abraflexi/src/core/abra-flexi-client.ts`. First, update the top import line:

```ts
import type {
  AbraFlexiInvoicePayload,
  AbraFlexiInvoiceResult,
  AbraFlexiOptions,
  AbraFlexiRecordPaymentPayload,
  AbraFlexiRecordPaymentResult,
} from "../types.js"
import { ABRA_FLEXI_VAT_RATE_CODE_BASIC, ABRA_FLEXI_PAYMENT_STATUS_CODE_PAID_MANUALLY } from "../types.js"
```

(replacing the existing two `import` lines at the top of the file)

Then add this method to the `AbraFlexiClient` class, after `createInvoice`:

```ts
  async recordPayment(
    payload: AbraFlexiRecordPaymentPayload
  ): Promise<AbraFlexiRecordPaymentResult> {
    let res: Response
    try {
      res = await this.fetchFn(`${this.base}/c/${this.company}/faktura-vydana.json`, {
        method: "PUT",
        headers: { Authorization: this.auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          winstrom: {
            "faktura-vydana": {
              id: `code:${payload.invoiceExternalCode}`,
              stavUhrK: `code:${ABRA_FLEXI_PAYMENT_STATUS_CODE_PAID_MANUALLY}`,
            },
          },
        }),
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
        "Abra Flexi: payment-status update response missing result id",
        false
      )
    }
    return { id: String(result.id) }
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test -- abra-flexi-client`
Expected: PASS, both `createInvoice` and `recordPayment` describe blocks.

- [ ] **Step 6: Commit**

```bash
git add packages/invoicing-abraflexi/src/types.ts packages/invoicing-abraflexi/src/core/abra-flexi-client.ts packages/invoicing-abraflexi/src/core/__tests__/abra-flexi-client.test.ts
git commit -s -m "feat(invoicing-abraflexi): add AbraFlexiClient.recordPayment"
```

---

### Task 3: `recordPaymentInAbraFlexiWorkflow`

**Files:**
- Create: `packages/invoicing-abraflexi/src/workflows/record-payment-in-abra-flexi.ts`
- Create: `packages/invoicing-abraflexi/src/workflows/__tests__/record-payment-in-abra-flexi.test.ts`
- Modify: `packages/invoicing-abraflexi/src/workflows/create-invoice-in-abra-flexi.ts` (export `resolveOrderStepFn`'s step wrapper is not needed — only the already-exported `resolveOrderStepFn` function is reused; no change needed to this file. Confirmed by inspection: `resolveOrderStepFn` is already `export async function` — skip this bullet, listed here only to record that it was checked, not to imply a change.)

**Interfaces:**
- Consumes: `resolveOrderStepFn` from `./create-invoice-in-abra-flexi.js` (Medusa's `Modules.PAYMENT`/`ContainerRegistrationKeys.QUERY` container resolution, same as Task 5's existing usage); `AbraFlexiClient.recordPayment` (Task 2); `abraFlexiExternalCodeForOrder` (Task 1); `ABRA_FLEXI_MODULE` from `../modules/abra-flexi/index.js`; `AbraFlexiApiError` from `../core/abra-flexi-client.js`.
- Produces (used by Task 4): `recordPaymentInAbraFlexiWorkflow(container)` — a Medusa workflow, `.run({ input: { paymentId: string } })`, resolving to `{ recordedPaymentIds: string[] }`. Also exports `recordPaymentStepFn` and `persistRecordedPaymentIdStepFn` (unit-tested directly, same pattern as `create-invoice-in-abra-flexi.ts`'s exported step functions).

- [ ] **Step 1: Write the failing unit tests**

Create `packages/invoicing-abraflexi/src/workflows/__tests__/record-payment-in-abra-flexi.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import { recordPaymentStepFn, persistRecordedPaymentIdStepFn } from "../record-payment-in-abra-flexi"
import { AbraFlexiApiError } from "../../core/abra-flexi-client"
import type { OrderDTO } from "@medusajs/framework/types"

const order = {
  id: "ord_1",
  email: "c@example.com",
  currency_code: "czk",
  metadata: {},
} as unknown as OrderDTO

function mockContainer(overrides: Record<string, unknown> = {}) {
  return { resolve: vi.fn((key: string) => overrides[key]) }
}

describe("recordPaymentStepFn", () => {
  it("calls the client with the given external code and returns its result", async () => {
    const client = { recordPayment: vi.fn().mockResolvedValue({ id: "99" }) }
    const container = mockContainer({ abraFlexi: { getClient: () => client } })

    const response = await recordPaymentStepFn(
      { externalCode: "order-ord_1" },
      { container } as never
    )

    expect(client.recordPayment).toHaveBeenCalledWith({ invoiceExternalCode: "order-ord_1" })
    expect(response.output).toEqual({ id: "99" })
  })

  it("rethrows a retryable AbraFlexiApiError so the workflow engine retries", async () => {
    const client = {
      recordPayment: vi.fn().mockRejectedValue(new AbraFlexiApiError(500, "boom", true)),
    }
    const container = mockContainer({ abraFlexi: { getClient: () => client } })

    await expect(
      recordPaymentStepFn({ externalCode: "order-ord_1" }, { container } as never)
    ).rejects.toMatchObject({ name: "AbraFlexiApiError", retryable: true })
  })

  it("converts a non-retryable AbraFlexiApiError into a permanent step failure", async () => {
    const client = {
      recordPayment: vi.fn().mockRejectedValue(new AbraFlexiApiError(400, "bad code", false)),
    }
    const container = mockContainer({ abraFlexi: { getClient: () => client } })

    await expect(
      recordPaymentStepFn({ externalCode: "order-ord_1" }, { container } as never)
    ).rejects.toMatchObject({
      // Medusa's PermanentStepFailureError sets its own .name to "PermanentStepFailure"
      // (no "Error" suffix) -- same as create-invoice-in-abra-flexi.test.ts's equivalent case.
      name: "PermanentStepFailure",
    })
  })
})

describe("persistRecordedPaymentIdStepFn", () => {
  it("appends the payment id to an empty recorded-ids list", async () => {
    const updateOrders = vi.fn().mockResolvedValue({})
    const container = mockContainer({ order: { updateOrders } })

    const response = await persistRecordedPaymentIdStepFn(
      { order, paymentId: "pay_1", recordedPaymentAbraFlexiId: "99" },
      { container } as never
    )

    expect(updateOrders).toHaveBeenCalledWith("ord_1", {
      metadata: { abra_flexi_recorded_payment_ids: ["pay_1"] },
    })
    expect(response.output).toEqual(["pay_1"])
  })

  it("appends to an existing list without dropping prior entries (split-tender)", async () => {
    const updateOrders = vi.fn().mockResolvedValue({})
    const container = mockContainer({ order: { updateOrders } })
    const orderWithExisting = {
      ...order,
      metadata: { abra_flexi_recorded_payment_ids: ["pay_0"] },
    } as OrderDTO

    const response = await persistRecordedPaymentIdStepFn(
      { order: orderWithExisting, paymentId: "pay_1", recordedPaymentAbraFlexiId: "100" },
      { container } as never
    )

    expect(updateOrders).toHaveBeenCalledWith("ord_1", {
      metadata: { abra_flexi_recorded_payment_ids: ["pay_0", "pay_1"] },
    })
    expect(response.output).toEqual(["pay_0", "pay_1"])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test -- record-payment-in-abra-flexi`
Expected: FAIL — `../record-payment-in-abra-flexi` module does not exist.

- [ ] **Step 3: Implement the workflow**

Create `packages/invoicing-abraflexi/src/workflows/record-payment-in-abra-flexi.ts`:

```ts
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  when,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework"
import type { OrderDTO } from "@medusajs/framework/types"
import { ABRA_FLEXI_MODULE } from "../modules/abra-flexi/index.js"
import type AbraFlexiModuleService from "../modules/abra-flexi/service.js"
import { AbraFlexiApiError } from "../core/abra-flexi-client.js"
import { abraFlexiExternalCodeForOrder } from "../core/order-to-invoice-mapper.js"
import { resolveOrderStepFn } from "./create-invoice-in-abra-flexi.js"
import type { AbraFlexiRecordPaymentResult } from "../types.js"

export interface RecordPaymentInAbraFlexiInput {
  paymentId: string
}

interface StepCtx {
  container: MedusaContainer
}

interface ResolvedOrder {
  order: OrderDTO
}

// Reuses create-invoice-in-abra-flexi.ts's resolveOrderStepFn (payment id -> order
// via the payment_collection_id link) rather than duplicating that query -- wrapped
// in its own createStep here (a distinct step name/instance per workflow, matching
// how this repo already keeps each workflow's steps self-contained) rather than
// importing a shared step object across two separate workflow definitions.
const resolveOrderStep = createStep(
  "resolve-order-from-payment-for-payment-record",
  resolveOrderStepFn
)

export async function recordPaymentStepFn(
  input: { externalCode: string },
  { container }: StepCtx
): Promise<StepResponse<AbraFlexiRecordPaymentResult>> {
  const abraFlexi = container.resolve<AbraFlexiModuleService>(ABRA_FLEXI_MODULE)
  try {
    const result = await abraFlexi
      .getClient()
      .recordPayment({ invoiceExternalCode: input.externalCode })
    return new StepResponse(result)
  } catch (e) {
    if (e instanceof AbraFlexiApiError && !e.retryable) {
      return StepResponse.permanentFailure(e.message)
    }
    throw e
  }
}
const recordPaymentStep = createStep(
  { name: "record-payment-in-abra-flexi", maxRetries: 3, retryInterval: 30 },
  recordPaymentStepFn
)

export async function persistRecordedPaymentIdStepFn(
  input: { order: OrderDTO; paymentId: string; recordedPaymentAbraFlexiId: string },
  { container }: StepCtx
): Promise<StepResponse<string[]>> {
  const orderModuleService = container.resolve(Modules.ORDER)
  const existing = Array.isArray(input.order.metadata?.abra_flexi_recorded_payment_ids)
    ? (input.order.metadata!.abra_flexi_recorded_payment_ids as string[])
    : []
  const updated = [...existing, input.paymentId]
  await orderModuleService.updateOrders(input.order.id, {
    metadata: {
      ...(input.order.metadata ?? {}),
      abra_flexi_recorded_payment_ids: updated,
    },
  })
  return new StepResponse(updated)
}
const persistRecordedPaymentIdStep = createStep(
  "persist-abra-flexi-recorded-payment-id",
  persistRecordedPaymentIdStepFn
)

export const recordPaymentInAbraFlexiWorkflow = createWorkflow(
  "record-payment-in-abra-flexi",
  (input: RecordPaymentInAbraFlexiInput) => {
    const resolved = resolveOrderStep(input)

    const alreadyRecorded = transform({ resolved, input }, ({ resolved, input }) => {
      const ids = resolved.order.metadata?.abra_flexi_recorded_payment_ids
      return Array.isArray(ids) && ids.includes(input.paymentId)
    })

    const recordedIds = when({ alreadyRecorded }, ({ alreadyRecorded }) => !alreadyRecorded).then(
      () => {
        const externalCodeInput = transform({ resolved }, ({ resolved }) => ({
          externalCode: abraFlexiExternalCodeForOrder(resolved.order.id),
        }))
        const recordResult = recordPaymentStep(externalCodeInput)
        return persistRecordedPaymentIdStep(
          transform({ resolved, input, recordResult }, ({ resolved, input, recordResult }) => ({
            order: resolved.order,
            paymentId: input.paymentId,
            // Included only to give this step a data dependency on recordResult, so
            // it runs after the API call succeeds, not in parallel with it -- mirrors
            // create-invoice-in-abra-flexi.ts's persistInvoiceIdStep taking the
            // created invoice as input for the same reason.
            recordedPaymentAbraFlexiId: recordResult.id,
          }))
        )
      }
    )

    const result = transform({ resolved, recordedIds }, ({ resolved, recordedIds }) => ({
      recordedPaymentIds:
        recordedIds ??
        ((resolved.order.metadata?.abra_flexi_recorded_payment_ids as string[] | undefined) ?? []),
    }))

    return new WorkflowResponse(result)
  }
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test -- record-payment-in-abra-flexi`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi typecheck`
Expected: no errors. Pay attention to `noUncheckedIndexedAccess` around `resolved.order.metadata?.abra_flexi_recorded_payment_ids` — the `Array.isArray` guard in both `persistRecordedPaymentIdStepFn` and the workflow's `alreadyRecorded` transform is what satisfies strict mode here (matches the existing `existingInvoiceId` cast pattern in `create-invoice-in-abra-flexi.ts`).

- [ ] **Step 6: Commit**

```bash
git add packages/invoicing-abraflexi/src/workflows/record-payment-in-abra-flexi.ts packages/invoicing-abraflexi/src/workflows/__tests__/record-payment-in-abra-flexi.test.ts
git commit -s -m "feat(invoicing-abraflexi): add recordPaymentInAbraFlexiWorkflow"
```

---

### Task 4: Extend the `payment.captured` subscriber

**Files:**
- Modify: `packages/invoicing-abraflexi/src/subscribers/payment-captured.ts`
- Modify: `packages/invoicing-abraflexi/src/subscribers/__tests__/payment-captured.test.ts`
- Modify: `packages/invoicing-abraflexi/README.md`

**Interfaces:**
- Consumes: `createInvoiceInAbraFlexiWorkflow` (existing), `recordPaymentInAbraFlexiWorkflow` (Task 3).
- Produces: nothing new — this is the integration point, nothing else depends on it.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `packages/invoicing-abraflexi/src/subscribers/__tests__/payment-captured.test.ts` with:

```ts
import { describe, it, expect, vi } from "vitest"

vi.mock("../../workflows/create-invoice-in-abra-flexi", () => ({
  createInvoiceInAbraFlexiWorkflow: vi.fn(),
}))
vi.mock("../../workflows/record-payment-in-abra-flexi", () => ({
  recordPaymentInAbraFlexiWorkflow: vi.fn(),
}))

import abraFlexiPaymentCapturedHandler, { config } from "../payment-captured"
import { createInvoiceInAbraFlexiWorkflow } from "../../workflows/create-invoice-in-abra-flexi"
import { recordPaymentInAbraFlexiWorkflow } from "../../workflows/record-payment-in-abra-flexi"

describe("payment-captured subscriber", () => {
  it("listens on payment.captured", () => {
    expect(config.event).toBe("payment.captured")
  })

  it("runs createInvoiceInAbraFlexiWorkflow then recordPaymentInAbraFlexiWorkflow with the payment id", async () => {
    const createRun = vi.fn().mockResolvedValue({ result: { id: "1", code: "order-ord_1" } })
    ;(createInvoiceInAbraFlexiWorkflow as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      run: createRun,
    })
    const recordRun = vi.fn().mockResolvedValue({ result: { recordedPaymentIds: ["pay_1"] } })
    ;(recordPaymentInAbraFlexiWorkflow as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      run: recordRun,
    })
    const container = {} as never

    await abraFlexiPaymentCapturedHandler({
      event: { data: { id: "pay_1" }, name: "payment.captured" },
      container,
      pluginOptions: {},
    } as never)

    expect(createInvoiceInAbraFlexiWorkflow).toHaveBeenCalledWith(container)
    expect(createRun).toHaveBeenCalledWith({ input: { paymentId: "pay_1" } })
    expect(recordPaymentInAbraFlexiWorkflow).toHaveBeenCalledWith(container)
    expect(recordRun).toHaveBeenCalledWith({ input: { paymentId: "pay_1" } })
  })

  it("does not run recordPaymentInAbraFlexiWorkflow when invoice creation fails", async () => {
    const createRun = vi.fn().mockRejectedValue(new Error("invoice creation failed"))
    ;(createInvoiceInAbraFlexiWorkflow as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      run: createRun,
    })
    const recordRun = vi.fn()
    ;(recordPaymentInAbraFlexiWorkflow as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      run: recordRun,
    })
    const container = {} as never

    await expect(
      abraFlexiPaymentCapturedHandler({
        event: { data: { id: "pay_1" }, name: "payment.captured" },
        container,
        pluginOptions: {},
      } as never)
    ).rejects.toThrow("invoice creation failed")

    expect(recordRun).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test -- payment-captured`
Expected: FAIL — `../../workflows/record-payment-in-abra-flexi` mock target doesn't match anything the subscriber imports yet, and the second test's `recordRun` assertion fails since the subscriber never calls it.

- [ ] **Step 3: Implement**

Replace the full contents of `packages/invoicing-abraflexi/src/subscribers/payment-captured.ts` with:

```ts
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { createInvoiceInAbraFlexiWorkflow } from "../workflows/create-invoice-in-abra-flexi.js"
import { recordPaymentInAbraFlexiWorkflow } from "../workflows/record-payment-in-abra-flexi.js"

export default async function abraFlexiPaymentCapturedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>): Promise<void> {
  await createInvoiceInAbraFlexiWorkflow(container).run({ input: { paymentId: data.id } })
  await recordPaymentInAbraFlexiWorkflow(container).run({ input: { paymentId: data.id } })
}

export const config: SubscriberConfig = {
  event: "payment.captured",
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test -- payment-captured`
Expected: PASS, both tests.

- [ ] **Step 5: Update the package README**

In `packages/invoicing-abraflexi/README.md`:

Replace the top summary paragraph (currently ending "... Idempotent — a second capture on an already-invoiced order is a no-op.") with:

```markdown
Abra Flexi invoicing for MedusaJS 2.0 (medusa-cz). Listens for `payment.captured`,
issues a Czech sales invoice in Abra Flexi, then marks it paid — both via durable,
retried Medusa workflows. Idempotent — a second capture on an already-invoiced
order creates no duplicate invoice, and a second capture with a *different*
payment id (Medusa's split-tender case) records that payment too, without
re-recording ones already seen.
```

Replace the "What it does" section's item 6 (currently ending the list) and everything after it up to "## Known gaps" with:

```markdown
6. Persist `abra_flexi_invoice_id` / `abra_flexi_invoice_code` onto `order.metadata`.
7. Mark the invoice paid: if the payment id is already in
   `order.metadata.abra_flexi_recorded_payment_ids`, stop — already recorded.
8. Otherwise, `PUT` the invoice's payment status (`stavUhrK`) to Abra Flexi's
   "paid manually" code. Same retry/failure behavior as invoice creation.
9. Append the payment id to `order.metadata.abra_flexi_recorded_payment_ids`.
```

In the "Known gaps (by design, deferred)" section, replace the bullet:

```markdown
- **Payment status sync, credit notes, general ledger.** Separate sub-projects
  (2-4) of the Abra Flexi milestone — not built here.
```

with:

```markdown
- **Credit notes, general ledger.** Separate sub-projects (3-4) of the Abra
  Flexi milestone — not built here. Payment status (sub-project 2) is built,
  via a direct field write, not a linked bank record — see
  `docs/superpowers/research/2026-09-06-abra-flexi-payment-api-verification.md`
  for why, and what upgrading to a bank-record-based approach would need.
- **Settlement-completeness / reconciliation.** Nothing here computes "is this
  invoice fully paid" or cross-checks captured amounts against invoice totals
  — that stays Abra Flexi's own concern. A periodic reconciliation job is a
  documented stretch goal, not built.
```

- [ ] **Step 6: Commit**

```bash
git add packages/invoicing-abraflexi/src/subscribers/payment-captured.ts packages/invoicing-abraflexi/src/subscribers/__tests__/payment-captured.test.ts packages/invoicing-abraflexi/README.md
git commit -s -m "feat(invoicing-abraflexi): chain payment recording after invoice creation"
```

---

### Task 5: DB-backed idempotency integration test

**Files:**
- Modify: `packages/invoicing-abraflexi/src/__tests__/integration/idempotency/mock-abra-flexi-server.ts`
- Create: `packages/invoicing-abraflexi/src/__tests__/integration/idempotency/record-payment-idempotency.test.ts`

**Interfaces:**
- Consumes: `recordPaymentInAbraFlexiWorkflow` (Task 3), `createInvoiceInAbraFlexiWorkflow` (existing), `startMockAbraFlexiServer` (extended below).
- Produces: nothing new for later tasks — this is a leaf test.

The existing mock server counts every `PUT .../faktura-vydana.json` call as an invoice creation. Since `recordPayment` (Task 2) PUTs to that *same* endpoint, the mock needs to tell the two apart by body shape, so this new test can assert on payment-recording calls specifically without disturbing the existing `create-invoice-idempotency.test.ts`'s `callCount()` usage.

- [ ] **Step 1: Extend the mock server (no test file changes needed — this is shared test infrastructure, verified by both idempotency tests passing)**

Replace the full contents of `packages/invoicing-abraflexi/src/__tests__/integration/idempotency/mock-abra-flexi-server.ts`:

```ts
import { createServer, type Server } from "node:http"

export interface MockAbraFlexiServer {
  baseUrl: string
  callCount: () => number
  paymentRecordCallCount: () => number
  close: () => Promise<void>
}

// Stands in for the real Abra Flexi API in the idempotency-guard integration tests
// (create-invoice-idempotency.test.ts, record-payment-idempotency.test.ts). No
// network, no sandbox credentials -- just enough of PUT
// /c/{company}/faktura-vydana.json's response shape for both
// AbraFlexiClient.createInvoice() and .recordPayment() to parse a success result
// (both PUT to the same endpoint -- Option A in
// docs/superpowers/research/2026-09-06-abra-flexi-payment-api-verification.md
// reuses faktura-vydana.json rather than a separate evidence type). The two call
// counters are told apart by body shape: a payment-status update body only ever
// contains `stavUhrK`, a create call never does. The tests assert on these counts
// to prove each workflow's own idempotency guard, not this mock, is what prevents
// duplicate calls on a retried/duplicated payment.captured event.
export async function startMockAbraFlexiServer(): Promise<MockAbraFlexiServer> {
  let createCalls = 0
  let paymentRecordCalls = 0

  const server: Server = createServer((req, res) => {
    if (req.method === "PUT" && req.url?.endsWith("/faktura-vydana.json")) {
      const chunks: Buffer[] = []
      req.on("data", (chunk: Buffer) => chunks.push(chunk))
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
        const invoice = body?.winstrom?.["faktura-vydana"] ?? {}
        const isPaymentRecord = "stavUhrK" in invoice
        if (isPaymentRecord) {
          paymentRecordCalls++
        } else {
          createCalls++
        }
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({
            winstrom: {
              success: true,
              results: [{ id: String(isPaymentRecord ? paymentRecordCalls : createCalls) }],
            },
          })
        )
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
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
```

- [ ] **Step 2: Run the existing idempotency test to confirm nothing broke**

Requires a real Postgres — see this plan's Global Constraints. If you don't have one reachable right now, skip straight to Step 3 (RED) and come back to run Steps 2/4/6 together once you do; do not skip verifying this for real before Step 7's commit.

Run: `DB_HOST=localhost DB_USERNAME=<user> DB_PASSWORD=<pass> DB_PORT=5432 pnpm --filter @medusa-cz/invoicing-abraflexi test:integration -- create-invoice-idempotency`
Expected: PASS, unchanged — `callCount()` still counts only invoice-creation calls.

- [ ] **Step 3: Write the failing test**

Create `packages/invoicing-abraflexi/src/__tests__/integration/idempotency/record-payment-idempotency.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { asValue } from "@medusajs/framework/awilix"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework"
import { createInvoiceInAbraFlexiWorkflow } from "../../../workflows/create-invoice-in-abra-flexi.js"
import { recordPaymentInAbraFlexiWorkflow } from "../../../workflows/record-payment-in-abra-flexi.js"
import { ABRA_FLEXI_MODULE } from "../../../modules/abra-flexi/index.js"
import AbraFlexiModuleService from "../../../modules/abra-flexi/service.js"
import { startMockAbraFlexiServer, type MockAbraFlexiServer } from "./mock-abra-flexi-server.js"

// Sibling to create-invoice-idempotency.test.ts's guard coverage -- proves
// recordPaymentInAbraFlexiWorkflow's own idempotency guard
// (order.metadata.abra_flexi_recorded_payment_ids) survives a real round trip
// through Postgres, same reasoning as that file's header comment (not repeated
// here -- same DB_HOST/pg-god/SSL requirements apply).
//
// The per-payment-id (not per-invoice) guard shape's split-tender behavior --
// recording a *different* payment id on the same order is NOT a no-op -- is
// covered at the unit level instead
// (record-payment-in-abra-flexi.test.ts's persistRecordedPaymentIdStepFn
// "appends to an existing list without dropping prior entries" case). Exercising
// that here would need a second real Medusa payment session/capture on the same
// payment collection, whose exact API shape for a split/zero-amount session
// isn't verified in this codebase -- not worth guessing at in a DB-backed test
// when the unit test already proves the guard's array-membership logic directly.
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
    describe("Abra Flexi record-payment idempotency guard (DB-backed)", () => {
      afterAll(async () => {
        await mock.close()
      })

      it("does not record a second payment when the workflow runs twice for the same payment id", async () => {
        const container = getContainer()
        const orderModuleService = container.resolve(Modules.ORDER)
        const paymentModuleService = container.resolve(Modules.PAYMENT)
        const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)

        const order = await orderModuleService.createOrders({
          email: "zakaznik@example.cz",
          currency_code: "czk",
          items: [{ title: "Tričko", quantity: 1, unit_price: 100 }],
          billing_address: { first_name: "Jan", last_name: "Novák" },
        })

        const paymentCollection = await paymentModuleService.createPaymentCollections({
          currency_code: "czk",
          amount: 100,
        })

        await remoteLink.create({
          [Modules.ORDER]: { order_id: order.id },
          [Modules.PAYMENT]: { payment_collection_id: paymentCollection.id },
        })

        const session = await paymentModuleService.createPaymentSession(paymentCollection.id, {
          provider_id: "pp_system_default",
          currency_code: "czk",
          amount: 100,
          data: {},
        })
        const payment = await paymentModuleService.authorizePaymentSession(session.id, {})
        await paymentModuleService.capturePayment({ payment_id: payment.id })

        await createInvoiceInAbraFlexiWorkflow(container).run({
          input: { paymentId: payment.id },
        })

        const first = await recordPaymentInAbraFlexiWorkflow(container).run({
          input: { paymentId: payment.id },
        })
        const second = await recordPaymentInAbraFlexiWorkflow(container).run({
          input: { paymentId: payment.id },
        })

        expect(mock.paymentRecordCallCount()).toBe(1)
        expect(second.result).toEqual(first.result)
      })
    })
  },
})

function skippedSuite() {
  describe.skip(
    "Abra Flexi record-payment idempotency guard (DB-backed) -- skipped, DB_HOST not set",
    () => {
      it("requires DB_HOST/DB_USERNAME/DB_PASSWORD/DB_PORT env vars pointing at a real Postgres", () => {})
    }
  )
}
```

- [ ] **Step 4: Run to verify RED, then GREEN**

Run: `DB_HOST=localhost DB_USERNAME=<user> DB_PASSWORD=<pass> DB_PORT=5432 pnpm --filter @medusa-cz/invoicing-abraflexi test:integration -- record-payment-idempotency`

If `recordPaymentInAbraFlexiWorkflow` (Task 3) isn't implemented yet at the point you run this, expect FAIL (module not found) — that's the RED you're verifying. Once Task 3 is done (it should already be, per this plan's task order), expect PASS: `mock.paymentRecordCallCount()` is `1` after two runs.

If you don't have `DB_HOST` set right now, this suite reports itself as skipped (see `skippedSuite()`) — that is not the same as passing. Do not commit this task claiming verification without having actually run it against a real Postgres at least once, per this repo's standing rule (`CLAUDE.md`'s `test:integration` section) that a silently-skipped suite looks identical to a passing one.

- [ ] **Step 5: Run the full package gate**

Run: `pnpm --filter @medusa-cz/invoicing-abraflexi test && pnpm --filter @medusa-cz/invoicing-abraflexi typecheck && pnpm --filter @medusa-cz/invoicing-abraflexi build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/invoicing-abraflexi/src/__tests__/integration/idempotency/mock-abra-flexi-server.ts packages/invoicing-abraflexi/src/__tests__/integration/idempotency/record-payment-idempotency.test.ts
git commit -s -m "test(invoicing-abraflexi): DB-backed idempotency guard for payment recording"
```

---

### Task 6: Extend the live opt-in sandbox suite

**Files:**
- Modify: `packages/invoicing-abraflexi/src/__tests__/integration/abra-flexi-sandbox.test.ts`

**Interfaces:**
- Consumes: `AbraFlexiClient.recordPayment` (Task 2).
- Produces: nothing — leaf test, and the real verification gate for whether `stavUhrK: "code:stavUhr.paidRucne"` actually works against a real Abra Flexi instance (the research in Task 2 is docs-only; nothing in Tasks 1-5 fires a real request).

- [ ] **Step 1: Add the live test case**

Add to `packages/invoicing-abraflexi/src/__tests__/integration/abra-flexi-sandbox.test.ts`, inside the existing `run("Abra Flexi sandbox (live)", () => { ... })` block, after the existing `it("creates a test invoice and returns its id/code", ...)` case:

```ts
  it("records a payment against a just-created invoice", async () => {
    const client = new AbraFlexiClient({
      baseUrl: baseUrl!,
      company: company!,
      username: username!,
      password: password!,
    })

    const externalCode = `sandbox-test-payment-${Date.now()}`
    await client.createInvoice({
      externalCode,
      currency: "CZK",
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      customer: { name: "Sandbox Test Customer", countryCode: "CZ" },
      lines: [{ name: "Integration test item", quantity: 1, unitPrice: 1 }],
      vatPayer: false,
    })

    const result = await client.recordPayment({ invoiceExternalCode: externalCode })
    expect(result.id).toBeTruthy()
  })
```

- [ ] **Step 2: Run against the real sandbox**

Requires real `ABRA_FLEXI_*` credentials as process env vars (see this package's `README.md` "Options" table) — this is the one step in this whole plan that needs them; everything else in Tasks 1-5 runs against mocks.

Run: `ABRA_FLEXI_BASE_URL=... ABRA_FLEXI_COMPANY=... ABRA_FLEXI_USERNAME=... ABRA_FLEXI_PASSWORD=... pnpm --filter @medusa-cz/invoicing-abraflexi test:integration -- abra-flexi-sandbox`

Expected: PASS. **If this fails, do not "fix" it by guessing a different field name** — re-check `docs/superpowers/research/2026-09-06-abra-flexi-payment-api-verification.md`'s Option A section against the real error message and the sandbox's own `/c/{company}/faktura-vydana/properties` endpoint (mentioned in that doc's sources) before changing `abra-flexi-client.ts`. This is the whole reason Task 6 exists as a separate, explicitly-run step rather than being folded into Task 2's mocked tests.

If you don't have live credentials available in this environment, this suite reports itself as skipped — say so explicitly rather than treating Tasks 1-5's green mocked tests as proof this works against the real API. Flag it back to whoever can run it with real credentials before this ships to production traffic.

- [ ] **Step 3: Commit**

```bash
git add packages/invoicing-abraflexi/src/__tests__/integration/abra-flexi-sandbox.test.ts
git commit -s -m "test(invoicing-abraflexi): live sandbox coverage for recordPayment"
```

---

## Done when

- All six tasks committed.
- `pnpm --filter @medusa-cz/invoicing-abraflexi test`, `typecheck`, `build` all green.
- Task 5's DB-backed test has actually been run against a real Postgres at least once (not just left to report "skipped").
- Task 6's live sandbox test has either actually been run against real Abra Flexi credentials, or been explicitly flagged as not yet verified live — never silently assumed to work.
- `docs/superpowers/specs/2026-09-06-m4-payment-sync-design.md`'s acceptance summary holds: every successful `payment.captured` results in exactly one Abra Flexi payment record per unique payment id, idempotently, with retry-on-transient-failure.
