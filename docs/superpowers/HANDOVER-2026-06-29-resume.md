# Resume Handover — medusa-cz (2026-06-29)

> **Paste this whole file as your first message after clearing context.** It tells you where
> everything stands and exactly what to do next. Then follow "▶ START HERE".

## ▶ START HERE (first actions on resume)
1. Read this file fully.
2. Read **`docs/superpowers/research/2026-06-29-packeta-fulfillment-verification.md`** (the Packeta + Medusa-2.17 fulfillment research; produced by a background agent at the end of the last session).
3. Read **`SERVER-OPS.md` §13** (Coolify/server deploy state) and **`docs/superpowers/specs/2026-06-13-medusa-cz-architecture-design.md`** (overall architecture; Packeta = §5.2, M2).
4. Skim **`docs/superpowers/plans/2026-06-15-m1-comgate.md`** — it's the **template** for how we build a plugin (research → spec → plan → strict TDD, task-by-task, atomic commits).
5. **Current job:** finish the **Packeta (Zásilkovna) plugin — Full M2** on **Medusa 2.17**. We were mid-`superpowers:brainstorming`: scope + version already decided (below); next step is to present the **design** (informed by the research doc) for user approval, then `superpowers:writing-plans` → TDD.

## Project in one paragraph
`medusa-cz` = open-source (MIT) suite of Czech-market MedusaJS 2.x integration plugins (pnpm + Turborepo monorepo at `C:\eshop`, repo `github.com/Reet93/Medusa_CZ_addin`, default branch `master`). Four plugins: **payment-comgate**, **fulfillment-packeta**, **payment-gopay**, **invoicing-fakturoid**, plus thin **`@medusa-cz/shared`** and a dev-harness demo (`apps/backend` = `@medusa-cz/demo`, `apps/storefront`). Build order: Comgate → **Packeta** → GoPay → Fakturoid.

## What's DONE
- **Comgate payment provider: COMPLETE + merged.** All 10 `AbstractPaymentProvider` methods, TDD, 25 unit tests + opt-in sandbox suite. PR #2 merged to master. README done.
- **Comgate packaging FIX: merged (PR #3).** Critical: `medusa plugin:build` emits ESM but `moduleResolution:Bundler` allowed extensionless relative imports that Node's ESM loader rejects → provider wouldn't load. **Fix = explicit `.js` extensions on relative value-imports + a `src/providers/<name>/index.ts` entry registered via the `./providers/*` export (gopay/Medusa convention).** **APPLY THIS PATTERN TO PACKETA (and all plugins) FROM THE START.**
- **Permissions:** `.claude/settings.local.json` has `permissions.defaultMode: "auto"` — work autonomously; only risky/irreversible actions prompt.

## Current task: Packeta — decisions already made
- **Scope:** **Full M2** — backend `AbstractFulfillmentProviderService` provider + REST/SOAP client (pickup-point lookup, rate/price, create shipment, label PDF, tracking, cancel) **AND** the storefront **pickup-point Widget v6** + checkout integration. (Widget half can't be fully exercised until the demo/storefront runs live, but build it.)
- **Target Medusa version: 2.17.0** (matches production; updates the architecture's locked decision from 2.15.5). The known fulfillment `canCalculate`/`calculatePrice` bug (#9495/#9598) status in 2.17 is answered in the research doc.
- **Testing:** TDD with **mocked HTTP** (like Comgate's 25 tests). No Packeta creds needed to build/unit-test; creds only matter for the eventual live round-trip.
- File structure per architecture spec §5.2 (provider service / core client / types / widget / index ModuleProvider / __tests__ / README), using the `.js`-extension + `providers/<name>/index.ts` packaging pattern.

## ⚠️ Version split to resolve (do this early in resume)
- `master` is still **2.15.5**. The **2.17 bump for the whole workspace lives on branch `m1-comgate-deploy`** (commit `e949a45`, bumps all `@medusajs/*` → 2.17.0 + `@medusajs/ui` 4.1.17; comgate verified green on 2.17). Before building Packeta on 2.17, **land that 2.17 bump on master** (cherry-pick `e949a45`'s package.json/lockfile changes, or open a small PR). Build Packeta on a fresh branch off the 2.17 master.

## PARKED (resume when unblocked)
- **Comgate live round-trip** — blocked on **Comgate sandbox creds** (user is in contact with Comgate; not easy to get). When creds arrive: install comgate into the live host backend (`~/medusa/mente-backend`, runs 2.17, migrates fine) + CZK region seed + test round-trip via Store API + sandbox. Decision: **run on the live server host, not Coolify** (no data on server yet; segregate dev/prod later).
- **Coolify deploy** — stood up + working (build, provider loads, DB connects) BUT in-container `medusa db:migrate` HANGS (container-specific: event loop awaits a never-resolving promise at "Running migrations"; ruled out our code, version, redis, worker mode, locks). Not pursued for now. All uuids/state in SERVER-OPS §13. A **Coolify API token** was shared in chat — user should revoke it (or reuse from §13).

## Branches
- `master` — Comgate provider + packaging fix (PR #2, #3). **Still 2.15.5.**
- `m1-comgate-deploy` (pushed) — Comgate packaging fix + demo wiring (medusa-config plugins+payment, CZK seed, env.template) + **2.17 bump** + `apps/backend/Dockerfile` (Coolify). Source of the 2.17 bump to cherry-pick.

## Server / infra (detail in SERVER-OPS.md)
- Live server `reet@192.168.0.156` (Tailscale `100.122.226.7`, public IP `188.75.149.32`). Production Medusa 2.17 on `:9000` (systemd, healthy, **untouched**). Postgres/Redis in Docker on 127.0.0.1. `reet` sudo = NOPASSWD `systemctl` only.
- Coolify installed on the server (`:8000`), project `medusa-cz`, isolated Postgres `medusa_demo` + Redis provisioned (see §13).
- `connect-server.bat` (OneDrive\Plocha) fixed (LAN-first → Tailscale fallback, goto-based; original in `.bat.bak`).

## Key learnings (don't re-derive)
- **Plugin ESM packaging:** `.js` import extensions + `providers/<name>/index.ts` + `./providers/*` export = loadable plugin. Add `"type": "module"` to the plugin package.json to silence the reparse warning (optional; tested benign in-container).
- **Medusa migrate/start hang** historically = a module loader awaiting a never-resolving promise (event-bus-redis bullWorker in prod → fixed via server/worker split; in the Coolify container it recurs for a still-unknown container-specific reason). Production host is the known-good environment.
- **`pnpm format:check` on Windows** reports false CRLF failures; trust CI (Linux/LF). `.prettierignore` excludes `apps/backend`/`apps/storefront`.
- Commit style: `git commit -s` (DCO required by CI). PRs via `gh`. CI = format:check → build → typecheck → lint → test (fail-fast).

## Next concrete steps on resume
1. Land the 2.17 bump on master (see version-split note).
2. Re-enter `superpowers:brainstorming` for Packeta: present the **design** (from the research doc) → get approval → write `docs/superpowers/specs/2026-06-29-packeta-design.md`.
3. `superpowers:writing-plans` → `docs/superpowers/plans/2026-06-29-packeta.md`.
4. Implement via strict TDD (mocked HTTP), atomic `-s` commits, on a `m2-packeta` branch → PR.
