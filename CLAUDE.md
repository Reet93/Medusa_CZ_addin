# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

`medusa-cz` — an open-core monorepo of Medusa v2 plugins for the Czech market
(payment, fulfillment, invoicing) plus a demo backend + storefront that doubles
as the sales demo. Turborepo + pnpm workspaces; each package publishes to npm
independently under the `@medusa-cz/*` scope.

- `packages/payment-comgate` — Comgate payment provider
- `packages/payment-gopay` — GoPay payment provider
- `packages/fulfillment-packeta` — Packeta (Zásilkovna) fulfillment provider
- `packages/invoicing-fakturoid` — Fakturoid invoicing module
- `packages/shared` — shared utilities
- `apps/backend` — Medusa backend (demo + integration host)
- `apps/storefront` — Next.js starter storefront (demo)

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

## Commands (run from repo root)

```bash
pnpm test            # turbo: run all package test suites (vitest)
pnpm typecheck       # turbo: tsc --noEmit across packages
pnpm lint            # turbo: eslint (storefront excluded)
pnpm build           # turbo: build all packages (storefront excluded)
pnpm format:check    # prettier check — CI gates on this
pnpm format          # prettier --write to fix formatting
```

Per-package: `cd packages/<name> && pnpm test` (and `test:integration` for the
opt-in live suites, which are skipped unless their env credentials are set).

## CI

`.github/workflows/ci.yml` runs on push to `master` (and on PRs):
`format:check → build → typecheck → lint → test`. The storefront is excluded
from the gated `build`/`lint` (its Next.js build needs a live backend + key).
Before pushing, run the full local sequence so CI stays green.

The DCO sign-off job only runs on PRs; pushing straight to `master` skips it,
but keep using `git commit -s` regardless.

## Server & backend

The Medusa backend runs on a **self-hosted server** (not local) — there is no
local Postgres by default. Connect via the local helper script:

- `C:\Users\sosno\OneDrive\Plocha\connect-server.bat` — opens an SSH session to
  the server as `reet`, **LAN-first with a Tailscale fallback** when off-network.
  (User-machine path, not in the repo.)

Full server operations — services (systemd server/worker split), paths, network,
backups, and the Coolify demo-deploy state — are documented in **`SERVER-OPS.md`**.

> ⚠️ The server hosts the **production** store. Do **not** run test/seed/fulfillment
> experiments (e.g. Packeta round-trips) against the production backend — use a
> dedicated demo/staging backend + database. See `SERVER-OPS.md` for which is which.
