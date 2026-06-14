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

---

## 7. Current state

- **Phase:** ✅ Design phase COMPLETE & approved. Spec committed (`fd0e534`) at `docs/superpowers/specs/2026-06-13-medusa-cz-architecture-design.md`. No integration code yet.
- **Next session:** `superpowers:writing-plans` scoped to **M0 (scaffold)** → then TDD execution.
- **Resolved:** Medusa pin (2.15.5), tooling (Turbo+pnpm), open-core seam (npm `shared`), DCO, demo strategy, build order, iÚčto→Stage 2.
- **Standing gate (carry forward):** §6 docs-verification against Medusa 2.15 runs BEFORE any scaffold code.
