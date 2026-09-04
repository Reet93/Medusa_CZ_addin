# AGENTS.md

Guidance for Codex when working in this repository.

## Project

`medusa-cz` — an open-core repo of Medusa v2 plugins for the Czech market
(payment, fulfillment, invoicing). Turborepo + pnpm workspaces; each package
publishes to npm independently under the `@medusa-cz/*` scope.

- `packages/payment-comgate` — Comgate payment provider
- `packages/payment-gopay` — GoPay payment provider
- `packages/fulfillment-packeta` — Packeta (Zásilkovna) fulfillment provider
- `packages/invoicing-abraflexi` — Abra Flexi invoicing module
- `packages/shared` — shared utilities

The demo backend + storefront that exercise these plugins end-to-end (the sales demo), plus
server-ops docs, live in a **private** companion repo, `mente-eshop` — not here. That repo
consumes these packages via a sibling-checkout `file:` link (see its own `CLAUDE.md`) until
the first real npm release, at which point it switches to a normal version dependency.

## Workflow — solo developer, NO feature branches

This is a **single-developer** project. **Do not create feature branches and do
not open pull requests.** Commit work directly to `master` and push.

- Work on `master`. If a topic branch already exists, fast-forward merge it into
  `master` and continue on `master`.
- Push straight to `origin/master` once local checks are green.
- Branches/PRs are only worth it if I explicitly ask for one (e.g. to share a
  diff for external review).

## Commits

- Conventional Commits: `feat(scope): …`, `fix(scope): …`, `docs: …`, etc.
- **Sign off every commit**: `git commit -s` (adds the `Signed-off-by` line the
  DCO check expects).

## Discipline

- **TDD** is the default for plugin code: write the failing test first
  (RED → GREEN → REFACTOR). The existing Packeta/Comgate suites were built this
  way — match that.
- Don't assume Medusa v2 provider base-class signatures from memory; they move
  between 2.x minors. Verify against the docs for the pinned version.
- A package here (currently only `invoicing-abraflexi`) may depend on another package in this
  repo (`@medusa-cz/shared`) — declare that as `file:../shared` (relative to the dependent
  package), not `workspace:*`. `workspace:*` only resolves inside this repo's own pnpm
  workspace and breaks for any external consumer that pulls the package in via a plain
  `file:` link (e.g. `mente-eshop`'s sibling-checkout convention above).

## Commands (run from repo root)

```bash
pnpm test            # turbo: run all package test suites (vitest)
pnpm typecheck       # turbo: tsc --noEmit across packages
pnpm lint            # turbo: eslint
pnpm build           # turbo: build all packages
pnpm format:check    # prettier check — CI gates on this
pnpm format          # prettier --write to fix formatting
```

Per-package: `cd packages/<name> && pnpm test` (and `test:integration` for the
opt-in live suites, which are skipped unless their env credentials are set).

## CI

`.github/workflows/ci.yml` runs on push to `master` (and on PRs):
`format:check → build → typecheck → lint → test`. Before pushing, run the full
local sequence so CI stays green.

The DCO sign-off job only runs on PRs; pushing straight to `master` skips it,
but keep using `git commit -s` regardless.
