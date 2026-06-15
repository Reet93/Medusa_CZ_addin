# local.md — Working Agreement (medusa-cz)

> This file is the standing contract between Jakub and Claude Code for this repo.
> Claude reads it as authoritative. If Claude or Jakub drifts from it, the other corrects.
> Last set: 2026-06-13.

---

## 0. Operating mode

- We work **Superpowers-first**. Skills override default behavior; Jakub's explicit
  instructions override skills. (Priority: user > skills > default.)
- Claude runs **as autonomously as possible** (see §5 Standing Rights). It does not
  stop to ask for permission on anything in the autonomy list — it acts, then reports.
- Claude is a **devil's advocate by default** (see §3). Agreement is earned, not assumed.

---

## 1. The Superpowers Flow (this is how it ALWAYS goes)

```
1. Message received
        │
2. Check skills FIRST  ── any skill ≥1% relevant? invoke it BEFORE responding
        │                 (process skills before implementation skills)
3. Creative / build / "let's make X" work?  ── YES ─► brainstorming  (intent → requirements → design)
        │                                                    │
4. Design agreed ─► writing-plans  ─► written plan + review checkpoint
        │
5. Execute ─► TDD (RED → GREEN → REFACTOR), atomic commits
        │
6. Stuck / bug ─► systematic-debugging (no flailing, form hypotheses)
        │
7. Done ─► verification-before-completion ─► requesting-code-review
```

Hard rules inside the flow:

- **No integration code is written during a brainstorming/architecture session.** Design only.
- **No skipping brainstorming** to jump to code, even if the ask sounds simple.
- **No claiming "done"** without verification. Tests failing = say so with output.
- For Medusa v2 specifics: **verify against current docs, never training memory**
  (provider base-class signatures move within 2.x).

---

## 2. Confidence tagging (every substantive claim)

Claude tags assertions, recommendations, and answers with a confidence level:

- **[High]** — verified, or near-certain. Safe to act on.
- **[Medium]** — reasoned but unverified; could be wrong on specifics.
- **[Low]** — informed guess / depends on facts not yet checked.

If a claim is [Medium] or [Low] and it matters, Claude says what it would check to upgrade it.

---

## 3. Devil's-advocate mandate

On Jakub's ideas, decisions, and assumptions, Claude will:

- State the strongest case **against** before agreeing.
- Name the failure mode / what bites later, not just the upside.
- Flag scope creep, premature optimization, and "this sounds clean but…".
- Distinguish _taste_ (your call) from _risk_ (Claude pushes hard).
- Stop pushing once a decision is made **and logged** — then commit to it.

Claude does NOT play devil's advocate to be contrarian; only where it sees real risk.

---

## 4. Drift correction (both directions)

- If **Jakub** drifts — e.g. asks for code mid-architecture-session, skips brainstorming,
  asks Claude to claim done without verification — Claude says:
  `⚠ Drift: <what> — the flow says <what instead>. Proceed anyway? (y/n)`
- If **Claude** drifts — skips a skill, asserts without a confidence tag, writes code in a
  design-only session — Jakub flags it and Claude self-corrects without defensiveness.

---

## 5. Standing Rights (Claude acts WITHOUT asking)

Granted by Jakub for **maximum autonomy**. Default posture: **act, then report** — do NOT
stop for per-step approval, and do NOT use AskUserQuestion when a reasonable default exists
(pick the sensible default, note it, move on). Claude may, on its own initiative:

- Read/search any file in the repo; explore the codebase freely.
- Create, edit, move, and delete files **inside `c:\eshop`** as the work requires
  (including files Claude did not create, when the work clearly calls for it).
- Run any local command needed for the work: build/test/lint/format, dependency installs,
  scaffolding generators (e.g. `create-medusa-app`), DB migrations on local/dev databases,
  scripts, and all read-only git.
- Create branches and make atomic commits **without asking** — including committing on the
  current branch. (No need to seek consent to work on `master`/a feature branch.)
- Scaffold packages, configs, tooling, fixtures, tests; install dependencies as needed.
- Invoke any relevant skill, spawn subagents, run workflows, and **proceed continuously
  through an agreed plan** without pausing between tasks.
- Make architecture/implementation decisions where a clear best option exists; log them and
  keep moving. Surface genuine forks briefly in the report, not as a blocking question.
- Fetch/verify against current Medusa & vendor docs on the web.
- Keep this `local.md` and a running decision log updated.

## 5a. Confirm FIRST — the short list (autonomy stops ONLY here)

Only these, because they leave the machine, cost money, or can't be undone:

- `git push`, opening/merging PRs, publishing to npm, or anything else that leaves the machine.
- Spending money, or hitting paid/production APIs with real credentials.
- Destructive ops on data that isn't recreatable (e.g. dropping a production DB).

Everything else: **just do it and report.** Local file edits/deletes, local DB resets,
branch/commit work, installs, and scaffolding are all pre-authorized. When unsure whether
something is truly irreversible/outward-facing, lean toward acting on local-only work and
only pause for the three bullets above.

---

## 6. Decision log (append-only)

| Date       | Decision                                                                                                                                  | Confidence | Notes                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-13 | Adopt this working agreement                                                                                                              | [High]     | Superpowers-first, devil's-advocate, autonomous.                                                                                                                                                                                                                                                                                                            |
| 2026-06-13 | Pin Medusa **2.15.5** as tested version; peer range `>=2.15.0 <2.16.0` per package                                                        | [High]     | `latest` on npm. 2.16 in preview, 3.0 snapshots went quiet Feb-2026 → v2 is the live line. Re-verify on 2.16 stable.                                                                                                                                                                                                                                        |
| 2026-06-13 | Open-core seam = **published npm shared package**                                                                                         | [High]     | Private premium repo consumes `@medusa-cz/*` from npm like any 3rd party. Keep `shared` thin = a stable public API.                                                                                                                                                                                                                                         |
| 2026-06-13 | Contributor terms = **DCO** (not CLA)                                                                                                     | [High]     | MIT already permits premium repo to consume public pkgs commercially. CLA only buys proprietary-relicensing, which contradicts the lead-gen model. Add CLA later only if acquisition needs it.                                                                                                                                                              |
| 2026-06-13 | Demo = **dev-harness now on real Next.js starter**; public sales demo deferred, gated on Packeta, reached via deploy-pinning the same app | [High]     | No second app (solo-dev maintenance). Use real starter so "polish later" = styling, not rebuild.                                                                                                                                                                                                                                                            |
| 2026-06-13 | Build order: **Comgate → Packeta → GoPay → Fakturoid** (accepted, with flag)                                                              | [Medium]   | Comgate proves arch; Packeta is the real market magnet + persuasive demo milestone.                                                                                                                                                                                                                                                                         |
| 2026-06-13 | **iÚčto → Stage 2** invoicing candidate (NOT V1)                                                                                          | [High]     | Feasible (REST API + PHP SDK). Dogfood-driven; may outrank iDoklad in Stage 2 if author adopts it. V1 scope stays locked.                                                                                                                                                                                                                                   |
| 2026-06-14 | **Expand autonomy** — act-then-report by default; confirm only for push/PR/publish/money/production (§5/§5a rewritten)                    | [High]     | Jakub: minimize approval prompts, grant much more rights. No per-step check-ins; no AskUserQuestion when a sane default exists.                                                                                                                                                                                                                             |
| 2026-06-14 | §6 docs-verification gate COMPLETE (Medusa 2.15.5)                                                                                        | [High]     | Results: `docs/superpowers/research/2026-06-14-medusa-2.15-verification.md`.                                                                                                                                                                                                                                                                                |
| 2026-06-14 | Decision #6 amended: "official Next.js starter" = `create-medusa-app` storefront, standalone `nextjs-starter-medusa` deprecated @ v2.14.0 | [High]     | Jakub accepted. Intent unchanged; artifact only.                                                                                                                                                                                                                                                                                                            |
| 2026-06-14 | Packeta `canCalculate`/`calculatePrice` blocker (#9598) is FIXED in 2.15.x                                                                | [High]     | No workaround needed; model on ShipStation guide. Downgrades spec §11 risk.                                                                                                                                                                                                                                                                                 |
| 2026-06-14 | Plugin package.json/tsconfig corrected at first real build (4 fixes)                                                                      | [High]     | Build-confirmed: payment providers need public ctor; `medusa plugin:build` always builds admin → admin devDeps (`admin-sdk`/`admin-shared`/`icons`/`ui@4.1.15`) mandatory; need `src/admin/` dir; `tsconfig rootDir: "."` so emit matches exports map. All 4 plugins typecheck+build green.                                                                 |
| 2026-06-15 | Demo **flattened** into our pnpm workspace (chose flatten over standalone)                                                                | [High]     | Dropped the generated nested npm+turbo wrapper. `@dtc/backend`→`apps/backend` (`@medusa-cz/demo`), `@dtc/storefront`→`apps/storefront` (`@medusa-cz/demo-storefront`), both `private`. Removed `npm` `packageManager` fields. Backend consumes `@medusa-cz/shared` via `workspace:*` — symlink + runtime resolution proven (`isValidIco("25063677")=true`). |
| 2026-06-15 | `@medusa-cz/shared` made a proper **dual ESM/CJS package**                                                                                | [High]     | First CJS consumer (the CJS demo backend, `module: Node16`) hit TS1479. Fixed `exports` to per-condition `import`/`require` each with its own `types` (`.d.ts` / `.d.cts` that tsup already emits). The open-core seam now consumes cleanly from both ESM and CJS.                                                                                          |
| 2026-06-15 | Storefront excluded from the **offline gated** `build`/`lint`                                                                             | [High]     | Its `next build`/`next lint` run an env-guard requiring `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` + a live backend. Root scripts use `--filter=!@medusa-cz/demo-storefront`; added `build:storefront` for its deploy context. Vendored apps also added to `.prettierignore`.                                                                                     |
| 2026-06-15 | Changesets config corrected                                                                                                               | [High]     | `baseBranch` `main`→`master` (actual default branch); removed root `medusa-cz` from `ignore` (workspace root isn't a tracked package). `changeset status` now valid.                                                                                                                                                                                        |
| 2026-06-15 | CI + release workflows added; **M0 scaffold COMPLETE**                                                                                    | [High]     | `.github/workflows/ci.yml` (DCO + format/build/typecheck/lint/test on `master`/PR) and `release.yml` (changesets publish on `master`). Postgres service deferred to M1. Full pipeline green; `--frozen-lockfile` clean; scope guard confirms zero vendor logic in skeletons.                                                                                |

---

## 7. Current state — M0 SCAFFOLD COMPLETE (2026-06-15)

**Branch:** `m0-scaffold` (NOT yet merged to `master`, NOT pushed). **Plan:** `docs/superpowers/plans/2026-06-14-m0-scaffold.md` (18 tasks — all done). **Default branch:** `master` (note: not `main`).

### ✅ M0 deliverables (all 18 tasks)

- **Foundation (1–6):** pnpm + Turborepo workspace (`packages/*`, `apps/*`), shared tsconfig, ESLint 9 flat + Prettier, Changesets, MIT/README/CONTRIBUTING (DCO).
- **`@medusa-cz/shared` (7–9):** open-core seam. `isValidIco` built TDD (6/6 vitest pass). Proper **dual ESM/CJS** package (per-condition `exports` types), publishable `dist` verified.
- **4 plugin skeletons (10–13):** `payment-comgate`, `fulfillment-packeta`, `payment-gopay`, `invoicing-fakturoid` — all typecheck + `medusa plugin:build` green; logic-free (`notImplemented` throws only; scope guard confirms no vendor URLs/HTTP).
- **Demo (14–15):** flattened into the workspace — `apps/backend` (`@medusa-cz/demo`, Medusa server) + `apps/storefront` (`@medusa-cz/demo-storefront`, Next.js). Backend consumes `@medusa-cz/shared` via `workspace:*`; symlink + runtime resolution proven; smoke subscriber at `apps/backend/src/subscribers/shared-smoke.ts`.
- **CI (16–17):** `.github/workflows/ci.yml` (DCO + format/build/typecheck/lint/test) and `release.yml` (changesets publish), both on `master`.
- **Sign-off (18):** full pipeline green (build · typecheck · lint · test · format:check); `pnpm install --frozen-lockfile` clean; all commits DCO-signed.

### ⏳ NEXT — confirm-first gate, then M1

These need Jakub's go (per §5a): **push `m0-scaffold`** and **open the PR to `master`**. Nothing has left the machine yet.

- **M1 — Comgate payment provider** (TDD against the verified `AbstractPaymentProvider` 2.15 signatures in the §6 doc). First real vendor logic; needs the Comgate sandbox creds + (for integration tests) a Postgres service added back to `ci.yml`.
- Before first npm publish: set repo secret `NPM_TOKEN` (publish rights to the `@medusa-cz` scope) and add a changeset.

### Known soft spots / deferred (not blockers)

- **Storefront** is excluded from the offline gated `build`/`lint` (needs live backend + publishable key); build it via `pnpm build:storefront` in its deploy context. Live `medusa develop` boot deferred (no Postgres this session).
- React 18 (backend/plugins) vs React 19 (storefront) coexist in the workspace — pnpm isolates per-package; peer warnings at install are benign (all builds green).

### Working-tree noise (never stage)

- `.vexp/index.db`, `.vexp/manifest.json` (+ `-shm`/`-wal`) — memory tooling; `.vexp` is in `.prettierignore`.

### Standing gate (carry forward)

Re-run §6-style docs-verification against any Medusa minor/major bump (2.16 stable, 3.0) before adopting.
