# Handover — M2 Packeta (backend + storefront + server deploy)

_Last updated: 2026-06-30. Branch: `master` (solo, no branches — see CLAUDE.md)._

## TL;DR

- **Code is complete and on `master`, CI green.** Packeta fulfillment provider
  (M2a) + storefront Widget v6 selection flow (M2b) are done.
- **Credentials are valid** (probed safely, no packets created). **Packeta account
  is NOT yet approved for posting parcels** (created today, ~3-day wait) — so live
  packet creation is blocked, but the **storefront selection flow is testable now**.
- **Server deploy (Path B) is ~90% done but paused.** Root cause of the only
  blocker was found and **fixed in the repo (commit `8e0becf`)** but **not yet
  built/deployed on the server**. One rebuild away.
- **Server is back to its original `mente-backend` (no Packeta), healthy.**
  The Packeta backend is stopped → **Packeta API is not in use**.
- **Secret is not leaked** (0 commits, 0 tracked files; lives only in two
  gitignored `.env` files).

## Credentials & safety

- Packeta **apiKey** (public, 16-char) + **apiPassword** (secret, 32-char) live in:
  - local `C:\eshop\.env.local` (gitignored) — keys named `PACKETA_API_KEY` /
    `PACKETA_API_SECRET`.
  - server `~/eshop/apps/backend/.env` (gitignored) — mapped to
    `PACKETA_API_KEY` / `PACKETA_API_PASSWORD`.
- Verified: neither value is in any git commit or tracked file.
- The eshop backend (which has the provider configured) is **stopped**; the
  running `mente-backend` has no Packeta plugin → no Packeta API calls happen.
- Optional extra safety: scrub the `PACKETA_*` lines from `~/eshop/apps/backend/.env`
  while paused (re-add from `.env.local` to resume). Not required (gitignored,
  backend stopped). Rotate the key in the Packeta portal if ever concerned.

## What was validated (Path A — safe API smoke test)

A standalone probe (`scratchpad/packeta-pathA.mjs`, reads `.env.local`, creates
nothing dangerous) proved the full chain up to the account gate:
- apiKey ✓ (validate endpoint `isValid=true`), apiPassword ✓ (authenticates).
- Real pickup-point lookup ✓; `createPacket` request is well-formed — it reached
  the **only** failing gate: `PacketAttributesFault → "client account is not
  approved for posting parcels."` Re-run after approval to confirm
  create → status → tracking → label → cancel.

## Key fixes made this session (all pushed to `master`)

- `2a47218` security: admin tracking/close-batch routes resolve the provider
  server-side — API password no longer accepted from the request.
- `2f37b52` storefront `@types/react` dedupe → 327 phantom tsc errors → 0;
  `568abae` gates storefront `tsc` in CI.
- `d758b75` **seed `provider_id` fix**: `fp_packeta_packeta` → `packeta_packeta`
  (confirmed against the live `fulfillment_provider` table).
- `26f315f` cap DB pool (`databaseDriverOptions.pool {min:0,max:5}`).
- `8e0becf` **register Redis modules** (cache/event-bus/workflow-engine) when
  `REDIS_URL` set. **This is the deploy-blocking fix — see below.**

## Server state (bare-metal, reet-server)

- Connect: `C:\Users\sosno\OneDrive\Plocha\connect-server.bat` (SSH `reet`,
  LAN `192.168.0.156` → Tailscale fallback). Node 20 via nvm; pnpm 9.15.0 enabled.
- **Running now:** original `medusa.service` + `medusa-worker.service` →
  `~/medusa/mente-backend/.../​.medusa/server` (vanilla, no Packeta), `health=200`.
- **Paused eshop deploy:** fresh clone at `~/eshop` (built), `.env` set with
  `PACKETA_*` + `DATABASE_URL` (db `medusa-mente-backend`) + `REDIS_URL`.
- **DB `medusa-mente-backend` already seeded** (idempotent done):
  - region **Czechia / czk**; shipping option **"Packeta pickup point" |
    provider_id `packeta_packeta` | calculated**; provider `packeta_packeta` enabled.
- **`max_connections` raised 50 → 200** in `~/medusa/docker-compose.yml`
  (postgres recreated; data persisted).
- Dead **Coolify demo backend** is still stuck on the §13 migrate-hang and should
  be deleted (was approved). Container `i8s78go8…`, DB `r12vnn8…/medusa_demo`.

### Root cause of the deploy blocker (fixed in repo, not yet deployed)

The eshop backend crash-looped on boot: logs showed `redisUrl not found → fake
redis`, then 60s later `Knex: Timeout acquiring a connection / 53300` — even
though Postgres had free slots. The working `mente-backend` config registers the
three **Redis modules**; our repo's `medusa-config.ts` did not, so it used the
**in-memory workflow engine**, which holds DB connections at boot and starves the
pool. Fix `8e0becf` adds the Redis modules. The last rebuild ran *before* this
commit landed (a 4-min SSH timeout cut the `git reset` short), so the server build
still lacks it.

## Resume steps (deploy the fix → test the selection flow)

On the server (`~/eshop`), with `PATH` including node:

```bash
sudo systemctl stop medusa.service medusa-worker.service        # stop mente-backend
cd ~/eshop && git fetch --depth 1 origin master && git reset --hard origin/master
grep -c event-bus-redis apps/backend/medusa-config.ts            # expect 1 (redis present)
cd apps/backend && npx medusa build                              # rebuild .medusa/server (~90s)
# repoint systemd to eshop (sudo cp is scoped to ~/medusa-units/*.service):
#   WorkingDirectory=/home/reet/eshop/apps/backend/.medusa/server
#   ExecStart=/home/reet/eshop/apps/backend/node_modules/.bin/medusa start   (NO `node` prefix — pnpm bin is an sh shim)
sudo systemctl daemon-reload && sudo systemctl start medusa.service          # server only first
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:9000/health        # want 200
```

Then test (no account approval needed): storefront → CZK cart → checkout →
select **Packeta pickup point** → widget opens → pick a point → it lands in the
cart shipping `data` (keys `pickup_point_*`) → **Continue** enables. Do **not**
close-batch; admin "Create fulfillment" stays blocked until Packeta approves.

### Still TODO for a full browser e2e

- **Storefront not deployed** (the "never finished" piece). Plan: build
  `apps/storefront` on the server, run via systemd, env: backend URL, the existing
  publishable key, `NEXT_PUBLIC_PACKETA_API_KEY`, default region = CZK; set
  `STORE_CORS`. (User chose bare-metal storefront earlier.)
- **Delete the dead Coolify demo backend.**
- After Packeta approval (~3 days): re-run Path A, then the full admin
  create-fulfillment → label → tracking → cancel round-trip.

## Gotchas captured

- pnpm `node_modules/.bin/medusa` is an **sh shim** — run it directly, never
  `node <shim>` (npm hoists a JS symlink, pnpm does not).
- Workspace plugins resolve from `apps/backend/node_modules/@medusa-cz/*` at
  runtime; `.medusa/server/node_modules/@medusa-cz` is expected to be empty.
- Bare-metal flat `.medusa/server` avoids the §13 container migrate-hang.
