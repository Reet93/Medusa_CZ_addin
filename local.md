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

- **[High]**   — verified, or near-certain. Safe to act on.
- **[Medium]** — reasoned but unverified; could be wrong on specifics.
- **[Low]**    — informed guess / depends on facts not yet checked.

If a claim is [Medium] or [Low] and it matters, Claude says what it would check to upgrade it.

---

## 3. Devil's-advocate mandate

On Jakub's ideas, decisions, and assumptions, Claude will:
- State the strongest case **against** before agreeing.
- Name the failure mode / what bites later, not just the upside.
- Flag scope creep, premature optimization, and "this sounds clean but…".
- Distinguish *taste* (your call) from *risk* (Claude pushes hard).
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

| Date | Decision | Confidence | Notes |
|------|----------|-----------|-------|
| 2026-06-13 | Adopt this working agreement | [High] | Superpowers-first, devil's-advocate, autonomous. |
| 2026-06-13 | Pin Medusa **2.15.5** as tested version; peer range `>=2.15.0 <2.16.0` per package | [High] | `latest` on npm. 2.16 in preview, 3.0 snapshots went quiet Feb-2026 → v2 is the live line. Re-verify on 2.16 stable. |
| 2026-06-13 | Open-core seam = **published npm shared package** | [High] | Private premium repo consumes `@medusa-cz/*` from npm like any 3rd party. Keep `shared` thin = a stable public API. |
| 2026-06-13 | Contributor terms = **DCO** (not CLA) | [High] | MIT already permits premium repo to consume public pkgs commercially. CLA only buys proprietary-relicensing, which contradicts the lead-gen model. Add CLA later only if acquisition needs it. |
| 2026-06-13 | Demo = **dev-harness now on real Next.js starter**; public sales demo deferred, gated on Packeta, reached via deploy-pinning the same app | [High] | No second app (solo-dev maintenance). Use real starter so "polish later" = styling, not rebuild. |
| 2026-06-13 | Build order: **Comgate → Packeta → GoPay → Fakturoid** (accepted, with flag) | [Medium] | Comgate proves arch; Packeta is the real market magnet + persuasive demo milestone. |
| 2026-06-13 | **iÚčto → Stage 2** invoicing candidate (NOT V1) | [High] | Feasible (REST API + PHP SDK). Dogfood-driven; may outrank iDoklad in Stage 2 if author adopts it. V1 scope stays locked. |
| 2026-06-14 | **Expand autonomy** — act-then-report by default; confirm only for push/PR/publish/money/production (§5/§5a rewritten) | [High] | Jakub: minimize approval prompts, grant much more rights. No per-step check-ins; no AskUserQuestion when a sane default exists. |
| 2026-06-14 | §6 docs-verification gate COMPLETE (Medusa 2.15.5) | [High] | Results: `docs/superpowers/research/2026-06-14-medusa-2.15-verification.md`. |
| 2026-06-14 | Decision #6 amended: "official Next.js starter" = `create-medusa-app` storefront, standalone `nextjs-starter-medusa` deprecated @ v2.14.0 | [High] | Jakub accepted. Intent unchanged; artifact only. |
| 2026-06-14 | Packeta `canCalculate`/`calculatePrice` blocker (#9598) is FIXED in 2.15.x | [High] | No workaround needed; model on ShipStation guide. Downgrades spec §11 risk. |
| 2026-06-14 | Plugin package.json/tsconfig corrected at first real build (4 fixes) | [High] | Build-confirmed: payment providers need public ctor; `medusa plugin:build` always builds admin → admin devDeps (`admin-sdk`/`admin-shared`/`icons`/`ui@4.1.15`) mandatory; need `src/admin/` dir; `tsconfig rootDir: "."` so emit matches exports map. All 4 plugins typecheck+build green. |

---

## 7. Current state — HANDOVER (paused 2026-06-14 ~21:48, mid-M0)

**Branch:** `m0-scaffold` (NOT merged to master). **Plan:** `docs/superpowers/plans/2026-06-14-m0-scaffold.md` (18 tasks). **Execution mode:** subagent-driven (clustered).

### ✅ Done & committed on `m0-scaffold` (in order)
- `3ed8d50` planning artifacts (plan + §6 verification doc)
- `afb835f` autonomy expansion (this file §5/§5a)
- Tasks 1–6 (foundation): `5cc9ba4`(pnpm+turbo) `a591d55`(tsconfig) `1e717c3`(turbo.json) `ed9e68b`(eslint+prettier) `fa94468`(changesets) `c3e3378`(license/readme/contributing)
- Tasks 7–9 (`@medusa-cz/shared`): `384c30f`(skeleton) `07e3303`(feat: isValidIco — 6 TDD tests pass) `3e0e9d5`(build/exports verified)
- Tasks 10–13 (4 plugin skeletons, all build green): `dd0cefb`(payment-comgate) `5779c04`(fulfillment-packeta) `44817e4`(payment-gopay) `80ce04c`(invoicing-fakturoid)

### ⏳ NEXT (resume here) — Tasks 14–15: demo app
**Blocker found (needs the structural decision below first):** `create-medusa-app@2.15.5 --with-nextjs-starter --skip-db` generated the **dtc-starter as its OWN self-contained npm+turbo monorepo** at `apps/demo/` (root pkg name `demo`, `workspaces: ["apps/**"]`, own `turbo.json` + `package-lock.json` + `node_modules`), containing `apps/demo/apps/backend` (`@dtc/backend` = Medusa server) and `apps/demo/apps/storefront` (`@dtc/storefront` = Next.js). This is raw, **untracked** (`apps/` shows `??` in git), NOT integrated, NOT committed. The plan's Task 14/15 assumed a bare backend + sibling storefront — needs updating.

**Recommended approach (my default for next session, [Medium]):** flatten into OUR pnpm workspace —
1. Move `apps/demo/apps/backend` → `apps/backend`, `apps/demo/apps/storefront` → `apps/storefront`; delete the generated wrapper (`apps/demo/{package.json,turbo.json,package-lock.json,node_modules,apps}`) to avoid nested-turbo/npm conflicts.
2. Rename `@dtc/backend` → `@medusa-cz/demo` and `@dtc/storefront` → `@medusa-cz/demo-storefront`, both `"private": true` (already in `.changeset` ignore list).
3. `pnpm install` (our root workspace already globs `apps/*`), then Task 15: add `@medusa-cz/shared: workspace:*` to the backend + the smoke subscriber, prove resolution.
   - **No Postgres needed for the proof** — use build/typecheck + `node -e "require.resolve('@medusa-cz/shared')"` from the backend dir; defer live boot. (Check if Postgres is available; if yes, do the full boot.)
   - Alt option B (if flattening fights the starter): keep `apps/demo` standalone/excluded from pnpm workspace and consume `@medusa-cz/*` via published npm later — but this loses spec §7's `workspace:*` live-dev symlink. Prefer flatten.
4. Then Tasks 16–17 (CI `ci.yml` + `release.yml`), Task 18 (clean `pnpm install --frozen-lockfile` + full `build/typecheck/lint/test/format:check` green; update this §7 to "M0 complete"; note Task 5's `changeset status` error self-resolves once the demo pkgs named in `.changeset` ignore exist).

### Working-tree noise (safe to ignore)
- `apps/` untracked (the raw demo scaffold above).
- `.vexp/index.db`, `.vexp/manifest.json` modified by the memory tooling — never stage these.

### Standing gate (carry forward)
Re-run §6-style docs-verification against any Medusa minor/major bump (2.16 stable, 3.0) before adopting.
