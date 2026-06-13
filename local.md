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

Granted by Jakub for maximum autonomy. Claude may, on its own initiative:

- Read/search any file in the repo; explore the codebase freely.
- Create, edit, move, and delete files **inside `c:\eshop`** as the work requires.
- Run read-only and build/test/lint/format commands (pnpm, turbo, node, git status/diff/log).
- Initialize git, create branches, make atomic commits with clear messages.
- Scaffold packages, configs, tooling, fixtures, and tests.
- Invoke any relevant skill, spawn subagents, and run workflows when scale warrants.
- Fetch/verify against current Medusa & vendor docs on the web.
- Install dependencies needed for the agreed plan.
- Keep this `local.md` and a running decision log updated.

## 5a. Always confirm FIRST (autonomy stops here)

- `git push`, opening PRs, publishing to npm, or anything that leaves the machine.
- Deleting/overwriting files Claude did **not** create, or that contradict their description.
- Spending money, hitting paid APIs with real credentials, or touching production.
- Writing **integration code** while we're still in an architecture/design session.
- Any irreversible or outward-facing action.

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

---

## 7. Current state

- **Phase:** Architecture discussion (pre-scaffold). No integration code yet.
- **Next:** `superpowers:brainstorming` on `prompt.md`.
- **Open question to resolve early:** pinned Medusa 2.x version (blocks anything version-specific).
