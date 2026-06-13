# medusa-cz — Architecture & Scaffold Design

- **Date:** 2026-06-13
- **Status:** Approved (design); pre-scaffold
- **Author:** Jakub + Claude Code (brainstorming session)
- **Scope:** Repo architecture, tooling, package archetypes, and the docs-verification gate for v1. No integration code.

---

## 1. Project summary

`medusa-cz` is an open-source (MIT) suite of Czech-market integration plugins for **MedusaJS 2.0**.
There is currently no Czech plugin ecosystem for Medusa 2.0 — the niche is open. The plugins are
free and act as lead-gen / reputation; revenue comes from consulting, building + hosting complete
Medusa eshops, paid support/SLA, and later open-core premium admin modules kept in a **separate
private repo**.

The repo is the sales page: "the Czech commerce stack for Medusa."

## 2. Locked decisions

| # | Decision | Confidence | Rationale |
|---|----------|-----------|-----------|
| 1 | **Pin Medusa `2.15.5`** as tested version; per-package peer range `>=2.15.0 <2.16.0` | High | `2.15.5` is `latest` on npm (2026-06-13). 2.16 in preview; 3.0 snapshots went quiet Feb-2026 → v2 is the live line. Re-verify deliberately when 2.16 ships stable. |
| 2 | **Monorepo + per-package independent npm publish** under `@medusa-cz/*` | High | One tooling/CI surface; atomic cross-package changes; consumers still install one package at a time. Separate-repo-per-plugin would multiply solo-dev maintenance. |
| 3 | **Turborepo + pnpm workspaces** as the task runner | High | Task caching + graph from day one; cheap to set up; pays off in CI and as packages grow. Plain pnpm would likely be bolted onto Turbo later anyway; Nx is overkill. |
| 4 | **Open-core seam = published npm `@medusa-cz/shared`** | High | Private premium repo consumes public packages from npm like any third party. Keep `shared` thin → a small, stable public API. |
| 5 | **Contributor terms = DCO** (sign-off line), not a CLA | High | MIT already lets the premium repo consume public packages commercially. A CLA only buys proprietary-relicensing, which contradicts the lead-gen model and adds PR friction. Add a CLA later only if an acquisition needs it. |
| 6 | **Demo = dev-harness now on the official Next.js starter**; public sales demo deferred, gated on Packeta, reached by **deploy-pinning the same app** | High | No second app to maintain solo. Using the real starter means "polish later" = styling, not a rebuild. |
| 7 | **Build order: Comgate → Packeta → GoPay → Fakturoid** | Medium | Comgate proves the architecture (clean REST). Packeta is the real market magnet + the milestone that makes the demo persuasive. |

## 3. Repo layout

```
medusa-cz/
├── apps/
│   └── demo/                    # Medusa backend + official Next.js starter
│                                #   dev-harness now → promoted to sales demo at Packeta milestone
├── packages/
│   ├── shared/                  # @medusa-cz/shared — THIN: cross-cutting CZ types + tiny utils (open-core seam)
│   ├── payment-comgate/         # @medusa-cz/payment-comgate
│   ├── fulfillment-packeta/     # @medusa-cz/fulfillment-packeta
│   ├── payment-gopay/           # @medusa-cz/payment-gopay
│   └── invoicing-fakturoid/     # @medusa-cz/invoicing-fakturoid
├── .changeset/                  # independent per-package versioning + npm publish
├── .github/workflows/           # CI: typecheck · lint · test · build · release · DCO check
├── turbo.json
├── pnpm-workspace.yaml
├── package.json                 # root devDeps + scripts
├── tsconfig.base.json
├── README.md                    # the public sales page
├── CONTRIBUTING.md              # DCO sign-off instructions
└── LICENSE                      # MIT
```

Stage-2 packages (`balikobot`, `idoklad`) slot into `packages/` later. Premium modules live in a
**separate private repo** that installs `@medusa-cz/*` from npm — never in this repo.

## 4. Shared tooling

> Items marked (docs-gate) depend on §6 verification against Medusa 2.15 before scaffolding.

- **TypeScript:** `tsconfig.base.json`, extended per package.
- **Build (docs-gate):** confirm whether 2.15 uses the official `medusa plugin:build` CLI vs a bundler, and the required `package.json` `exports` map for a v2 plugin/provider.
- **Lint/format:** ESLint + Prettier (Medusa-ecosystem standard). Biome is a possible faster solo-dev alternative; default to the ecosystem standard.
- **Test:** Vitest for unit tests; Medusa's official test-utils for integration against a throwaway Medusa instance (exact package/version is docs-gate).
- **Release:** Changesets → independent per-package semver + npm publish under `@medusa-cz/*`.
- **CI:** GitHub Actions — typecheck, lint, test, build (Turbo-cached), Changesets release, DCO sign-off check.

## 5. Package archetypes

> Base-class method signatures are docs-gate (§6) — verified against 2.15 before scaffolding.

### 5.1 Payment provider (Comgate, GoPay)
```
src/services/<x>-provider.ts   # extends AbstractPaymentProvider
src/core/<x>-client.ts         # thin TS REST client (mirrors the vendor PHP/official SDK)
src/types.ts
src/index.ts                   # ModuleProvider export
src/__tests__/
README.md                      # copy-paste install + .env example
```

### 5.2 Fulfillment provider (Packeta) — the hard one
```
src/services/packeta-provider.ts   # extends AbstractFulfillmentProviderService
src/core/packeta-client.ts
src/widgets/pickup-point/           # client-side React widget (Packeta widget v6), exported for storefront checkout
src/index.ts
src/__tests__/
README.md
```
The `canCalculate`/`calculatePrice` v2 fulfillment bug (medusajs/medusa Discussion #9495 / Issue
#9598) is verified against 2.15 specifically before the workaround is designed.

### 5.3 Module + subscribers (Fakturoid)
```
src/modules/fakturoid/         # module definition + service
src/subscribers/order-*.ts     # order events → create invoice
src/core/fakturoid-client.ts   # OAuth2 client-credentials, single-tenant
src/__tests__/
README.md
```

## 6. Pre-scaffold docs-verification gate

Before any scaffold code is written, verify against **Medusa 2.15** docs/source (not training memory):

1. v2 plugin project structure + build command + `package.json` `exports` format.
2. `AbstractPaymentProvider` full method signatures in 2.15.
3. `AbstractFulfillmentProviderService` signatures **and** whether `canCalculate`/`calculatePrice` (#9495/#9598) is fixed in 2.15.
4. Provider + module registration shape in `medusa-config.ts`.
5. Subscriber API + exact event names (e.g. order placed/completed).
6. Test-utils package name/version compatible with 2.15.
7. Official Next.js starter version for 2.15 + how a fulfillment pickup widget plugs into its checkout.

## 7. How the demo consumes local packages

`apps/demo/package.json` depends on `"@medusa-cz/payment-comgate": "workspace:*"` (etc.). pnpm
symlinks the workspace packages; Turbo builds packages before the demo runs; `medusa-config.ts`
registers each provider/module. A plugin under development is exercised live in the demo with no
publish step. The exact `medusa-config.ts` registration shape for 2.15 is docs-gate (§6).

## 8. Open-core seam

`@medusa-cz/shared` (published to npm) holds **only** cross-cutting concerns — CZ value types
(IČO/DIČ/address validation), HTTP-error normalization, common config shapes. Provider HTTP clients
stay inside their own package. A thin `shared` keeps the public API small and stable for the private
premium repo to depend on.

## 9. Milestones

- **M0 — Scaffold:** repo, tooling, CI, `shared`, empty package skeletons, demo wired.
- **M1 — Comgate:** proves the payment-provider archetype end-to-end in the demo.
- **M2 — Packeta:** market magnet; pickup widget; fulfillment-bug workaround → public sales-demo milestone.
- **M3 — GoPay:** validates the payment archetype generalizes to a second provider.
- **M4 — Fakturoid:** the module + subscriber archetype.

## 10. Explicitly out of scope (v1)

- **POHODA / Stormware** — desktop, Windows-bound mServer XML; paid bespoke work only, never a free self-serve plugin.
- **Balíkobot, iDoklad** — Stage 2.
- **Premium modules** — separate private repo.

## 11. Open risks / watch-items

- Medusa ships breaking changes within 2.x (Zod 3→4 in 2.14, MikroORM 5→6 in 2.4, product dimension fields → float in 2.15). Expect ~one controlled migration per quarter; the pinned-version + range strategy bounds the blast radius.
- Fulfillment `canCalculate`/`calculatePrice` flow is the single biggest technical risk (Packeta milestone).
- `shared` API stability is a standing discipline — every addition becomes a public contract.
- Deferred public-demo polish must not become "never"; gated explicitly on the Packeta milestone.
