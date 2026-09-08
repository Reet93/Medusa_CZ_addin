# CLAUDE.md

Guidance for Claude Code when working in this repository.

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
pnpm test              # turbo: run all package test suites (vitest)
pnpm test:integration  # turbo: opt-in suites — DB-backed + live-credential, see below
pnpm typecheck         # turbo: tsc --noEmit across packages
pnpm lint              # turbo: eslint
pnpm build             # turbo: build all packages
pnpm format:check      # prettier check — CI gates on this
pnpm format            # prettier --write to fix formatting
```

Per-package: `cd packages/<name> && pnpm test` (and `test:integration` for that
package's own opt-in suites).

`test:integration` covers two different kinds of opt-in suite, both skipped by
default:

- **DB-backed** (currently: `invoicing-abraflexi`'s 3 idempotency-guard tests —
  invoice creation, credit notes, payment-status sync) — needs `DB_HOST`/
  `DB_USERNAME`/`DB_PASSWORD`/`DB_PORT` pointing at a real Postgres with
  `CREATEDB` rights; runs in CI against the `postgres:16-alpine` service in
  `ci.yml`.
  **`DB_HOST` must be the literal string `localhost`, not an IP like
  `127.0.0.1`** — `@medusajs/test-utils`' `medusa-test-runner-utils/config.js`
  force-enables `ssl: { rejectUnauthorized: false }` in the driver options
  whenever `clientUrl` doesn't contain the substring `"localhost"`, and a
  plain (non-SSL) Postgres then hangs the connection pool for the full
  `hookTimeout` instead of failing fast (surfaces as `Knex: Timeout acquiring
  a connection. The pool is probably full`, with zero trace of the attempt in
  `pg_stat_activity` — looks like a resource/config problem, isn't one).
  `ci.yml` already uses `localhost` and was never affected; only hit when
  running these tests by hand against a Postgres reached via its IP. Verified
  the hard way 2026-09-08 diagnosing a run against the Coolify deployment's
  Postgres.
- **Live sandbox** (Comgate/Packeta/Abra Flexi) — needs each provider's own
  real API credentials (`COMGATE_MERCHANT`/`SECRET`, `PACKETA_API_PASSWORD`/
  `ESHOP`, `ABRA_FLEXI_*`); deliberately **not** CI secrets in a public repo,
  so these stay skipped in CI and only run when a developer sets them by hand.

Adding a new opt-in suite (either kind)? Its env var(s) must be declared in
`turbo.json`'s `test:integration` task `env` list, or Turbo's strict env mode
silently strips them before the task's process even starts — the suite then
just reports "skipped" with no error, in CI or locally, which looks identical
to the credentials genuinely being unset. Verified the hard way once already.

## CI

`.github/workflows/ci.yml` runs on push to `master` (and on PRs):
`format:check → build → typecheck → lint → test → test:integration`. Before
pushing, run the full local sequence so CI stays green (`test:integration`
itself won't have a DB locally unless you set the env vars above — that's
fine, it just skips, same as CI does for the two live-sandbox packages).

The DCO sign-off job only runs on PRs; pushing straight to `master` skips it,
but keep using `git commit -s` regardless.
