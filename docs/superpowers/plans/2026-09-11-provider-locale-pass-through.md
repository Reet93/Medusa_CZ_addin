# Provider Locale Pass-Through Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a shopper is on the storefront's Czech locale, Comgate's hosted payment page
shows in Czech too (it currently shows in whatever Comgate defaults to, since the plugin sends
no language hint at all); the Packeta pickup-point widget already follows a hardcoded `"cs"` —
make it follow the active locale instead.

**Architecture:** Comgate's Create Payment API accepts a `lang` parameter. The storefront passes
the active locale through `initiatePaymentSession`'s opaque `data` payload (already exactly the
mechanism this provider reads its own per-session data from); the plugin maps it to Comgate's
language code, defaulting to `cs` when absent or unrecognized. The Packeta change is
storefront-only — the widget library already accepts a `language` option, only the hardcoded
call site changes.

**Tech Stack:** `payment-comgate` package: TypeScript, `vitest` (this repo's real TDD
discipline — RED/GREEN/REFACTOR, Conventional Commits, `git commit -s` for the DCO check).
`mente-eshop` storefront: no new tooling, both changes are small edits to existing files.

**Spec:** `mente-eshop/docs/superpowers/specs/2026-09-11-storefront-czech-i18n-design.md`

## Global Constraints

- Two locales only: `en`, `cs`. Comgate's `lang` supports more (`de`, `sk`, `hu`, etc.) but this
  plan only ever sends `cs` or `en`.
- Default to `cs` whenever the locale is absent, unrecognized, or anything other than `en` —
  matches the storefront's own default-locale behavior from the i18n-foundation plan.
- **GoPay is explicitly out of scope for this plan.** `packages/payment-gopay`'s
  `GopayProviderService` is an unimplemented M0 skeleton — every method throws
  `"...not implemented (M0 skeleton)"`, including `initiatePayment`. Adding a `lang` parameter
  to a method with no real request-building logic yet would be guessing at an interface that
  doesn't exist. Add GoPay's locale pass-through as part of its real M3 implementation, not
  before — this plan doesn't touch `payment-gopay` at all.
- `packages/payment-comgate` changes: this repo's full CLAUDE.md discipline applies — TDD,
  Conventional Commits (`feat(payment-comgate): ...`), `git commit -s`, work directly on
  `master` (no feature branches), push once local checks are green.
- After changing `payment-comgate`, it must be rebuilt (`pnpm build` in `eshop`) for
  `mente-eshop`'s `file:../../../eshop/packages/payment-comgate` dependency to pick up the
  change (per `mente-eshop/CLAUDE.md`'s sibling-checkout note) — Task 2 depends on Task 1's
  build output, not just its source.

---

## Task 1: Comgate — map the active locale to Comgate's `lang` parameter

**Files:**
- Modify: `packages/payment-comgate/src/types.ts`
- Modify: `packages/payment-comgate/src/services/comgate-provider.ts`
- Modify: `packages/payment-comgate/src/services/__tests__/comgate-provider.test.ts`

**Interfaces:**
- Produces: `initiatePayment` now reads `input.data?.locale` and forwards a `lang: "cs" | "en"`
  field to `ComgateClient.create()`. No change to the method's own signature or return shape.

- [ ] **Step 1: Write the failing tests**

Add to the existing `describe("initiatePayment", ...)` block in
`packages/payment-comgate/src/services/__tests__/comgate-provider.test.ts` (mirrors the existing
test in that block exactly — same mock setup already at the top of the file, unchanged):

```ts
  it("maps locale 'cs' to Comgate lang 'cs'", async () => {
    create.mockResolvedValue({ code: 0, message: "OK", transId: "T1", redirect: "https://pay/T1" })
    const provider = makeProvider()
    await provider.initiatePayment({
      amount: 10,
      currency_code: "czk",
      data: { session_id: "ps_1", locale: "cs" },
    } as never)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ lang: "cs" }))
  })

  it("maps locale 'en' to Comgate lang 'en'", async () => {
    create.mockResolvedValue({ code: 0, message: "OK", transId: "T1", redirect: "https://pay/T1" })
    const provider = makeProvider()
    await provider.initiatePayment({
      amount: 10,
      currency_code: "czk",
      data: { session_id: "ps_1", locale: "en" },
    } as never)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ lang: "en" }))
  })

  it("defaults to lang 'cs' when locale is absent", async () => {
    create.mockResolvedValue({ code: 0, message: "OK", transId: "T1", redirect: "https://pay/T1" })
    const provider = makeProvider()
    await provider.initiatePayment({
      amount: 10,
      currency_code: "czk",
      data: { session_id: "ps_1" },
    } as never)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ lang: "cs" }))
  })

  it("defaults to lang 'cs' for an unsupported locale value rather than forwarding it as-is", async () => {
    create.mockResolvedValue({ code: 0, message: "OK", transId: "T1", redirect: "https://pay/T1" })
    const provider = makeProvider()
    await provider.initiatePayment({
      amount: 10,
      currency_code: "czk",
      data: { session_id: "ps_1", locale: "de" },
    } as never)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ lang: "cs" }))
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/payment-comgate && pnpm test`
Expected: FAIL — `create` isn't called with a `lang` field yet (`ComgateCreateInput` doesn't
even have the field, so this won't compile until Step 3's type change either — expect a
TypeScript error at this point if running via `vitest` with type-checking, or a runtime
assertion failure if not; either way, not green).

- [ ] **Step 3: Add the `lang` field to the request type**

In `packages/payment-comgate/src/types.ts`, add one field to the existing `ComgateCreateInput`
interface (which currently has `price`, `curr`, `label`, `refId`, `email?`, `prepareOnly`,
`preauth?`, `method?`, `country?`, `test?`, `url_paid?`, `url_cancelled?`, `url_pending?`):

```ts
  lang?: string // Comgate's hosted payment page language, e.g. "cs" | "en"
```

- [ ] **Step 4: Map locale → Comgate `lang` in `initiatePayment`**

In `packages/payment-comgate/src/services/comgate-provider.ts`, `initiatePayment` currently
builds its `this.client_.create({...})` call from `input.amount`/`input.currency_code`/a `refId`
derived from `input.data`/`input.context`. Add a small mapping helper and one more field to that
call:

```ts
const SUPPORTED_COMGATE_LANGS = new Set(["cs", "en"])

function toComgateLang(locale: unknown): string {
  return typeof locale === "string" && SUPPORTED_COMGATE_LANGS.has(locale) ? locale : "cs"
}
```

(place this near the top of the file, alongside the existing `toMinorUnits` import or as a
private method on the class — match whichever style the rest of the file already uses for small
pure helpers) and inside `initiatePayment`'s `this.client_.create({...})` call, add:

```ts
lang: toComgateLang(input.data?.locale),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/payment-comgate && pnpm test`
Expected: PASS, all four new assertions plus the existing suite green.

- [ ] **Step 6: Full package check**

```bash
cd packages/payment-comgate
pnpm build
pnpm typecheck
pnpm lint
```

Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add packages/payment-comgate/src/types.ts packages/payment-comgate/src/services/comgate-provider.ts packages/payment-comgate/src/services/__tests__/comgate-provider.test.ts
git commit -s -m "feat(payment-comgate): map storefront locale to Comgate's lang parameter"
```

- [ ] **Step 8: Push**

```bash
git push origin master
```

---

## Task 2: Storefront — send the active locale when initiating a Comgate payment session

**Files:**
- Modify: `apps/storefront/src/modules/checkout/components/payment/index.tsx`

**Interfaces:**
- Consumes: `getLocale` from `@lib/data/locale-actions` (existing server action, already used
  the same way — awaited directly from a client component — in `cart.ts`'s own internals).

- [ ] **Step 1: Rebuild the plugin dependency first**

This depends on Task 1's `payment-comgate` build output, not just its source (`file:` links
resolve to the built `dist/`, per `mente-eshop/CLAUDE.md`'s sibling-checkout note):

```bash
cd ../../eshop && pnpm build
cd ../mente-eshop/apps/backend && pnpm install
```

- [ ] **Step 2: Pass the locale into the real payment-initiation call**

In `apps/storefront/src/modules/checkout/components/payment/index.tsx`, add
`import { getLocale } from "@lib/data/locale-actions"` and change the `handleSubmit` function's
payment-session call (the one gated by `if (!checkActiveSession)`, **not** the earlier
`isStripeLike`-only call in `setPaymentMethod` — Comgate is never stripe-like, so only this one
matters here) from:

```ts
        await initiatePaymentSession(cart, {
          provider_id: selectedPaymentMethod,
        })
```

to:

```ts
        const locale = await getLocale()
        await initiatePaymentSession(cart, {
          provider_id: selectedPaymentMethod,
          data: { locale: locale ?? undefined },
        })
```

- [ ] **Step 3: Manual QA**

With the i18n-foundation plan's Czech switcher live and the sandbox Comgate credentials set:
switch to Czech, go through checkout to the Comgate redirect, confirm Comgate's hosted page
renders in Czech. Switch to English, repeat, confirm it renders in English.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck` (repo root)
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/modules/checkout/components/payment/index.tsx
git commit -s -m "feat(storefront): send active locale to Comgate on payment session init"
```

---

## Task 3: Packeta widget — follow the active locale

**Files:**
- Modify: `apps/storefront/src/modules/checkout/components/packeta-pickup-point/index.tsx`

**Interfaces:**
- Consumes: `getLocale` from `@lib/data/locale-actions`; `pickPacketaPoint` (existing,
  unchanged signature — `apps/storefront/src/lib/packeta.ts`).

- [ ] **Step 1: Pass the active locale as the widget's `language` option**

In `apps/storefront/src/modules/checkout/components/packeta-pickup-point/index.tsx`, the current
call is `const point = await pickPacketaPoint(apiKey)` (relying on `pickPacketaPoint`'s
hardcoded default `{ country: "cz", language: "cs" }`). Add
`import { getLocale } from "@lib/data/locale-actions"` and change the call to:

```ts
const locale = await getLocale()
const point = await pickPacketaPoint(apiKey, {
  country: "cz",
  language: locale === "en" ? "en" : "cs",
})
```

(`country` stays hardcoded to `"cz"` — that's the shipping destination the Packeta pickup-point
picker is scoped to, unrelated to UI language; the spec doesn't ask for multi-country shipping.)

- [ ] **Step 2: Manual QA**

Switch to English, open the Packeta pickup-point picker in checkout, confirm its own UI
(the widget's popup, served by Packeta) renders in English. Switch to Czech, confirm it renders
in Czech.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck` (repo root)
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/storefront/src/modules/checkout/components/packeta-pickup-point/index.tsx
git commit -s -m "feat(storefront): Packeta pickup-point widget follows the active locale"
```

---

## Task 4: Regression pass and handover note

**Files:**
- Modify: `mente-eshop/local.md`

- [ ] **Step 1: Run the full local check sequence in both repos**

```bash
cd eshop && pnpm typecheck && pnpm lint && pnpm test
cd ../mente-eshop && pnpm typecheck
```

Expected: all clean.

- [ ] **Step 2: End-to-end manual pass**

Full checkout in both locales with real Comgate sandbox credentials and a real Packeta pickup
point selection: confirm both providers' own UI (Comgate's hosted page, Packeta's widget popup)
match the storefront's active locale at the moment of checkout.

- [ ] **Step 3: Append a handover note to `local.md`, commit and push**

```bash
git add local.md
git commit -s -m "docs: note provider locale pass-through complete (Comgate + Packeta; GoPay deferred to its M3 implementation)"
git push origin master
```
