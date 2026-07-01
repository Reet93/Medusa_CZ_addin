# Handover — M2 Packeta (backend + storefront + server deploy)

_Last updated: 2026-06-30. Branch: `master` (solo, no branches — see CLAUDE.md)._

## TL;DR

- **Code is complete and on `master`, CI green.** Packeta fulfillment provider
  (M2a) + storefront Widget v6 selection flow (M2b) are done.
- **Credentials are valid** (probed safely, no packets created). **Packeta account
  is NOT yet approved for posting parcels** (created today, ~3-day wait) — so live
  packet creation is blocked, but the **storefront selection flow is testable now**.
- **Server deploy (Path B) is DONE.** The Redis-modules fix (`8e0becf`) is built
  and running on the box (HEAD `234b1ba`). Backend boots clean and holds
  `health=200` (Redis cache/event-bus/workflow-engine all "established" in logs;
  no more `53300` pool-timeout loop). `medusa.service` + `medusa-worker.service`
  both active, pointed at `~/eshop`.
- **Packeta is deployed but NEUTERED — cannot fire.** Per user request, the
  server `.env` holds **dummy** `PACKETA_API_KEY` / `PACKETA_API_PASSWORD`
  (`DISABLED_no_*_on_box`) + `PACKETA_VALIDATE_POINT=false`. The provider loads
  (validateOptions only checks non-empty) but has no valid secret to call Packeta
  with. Real keys live only in local `.env.local` — restore them to go live
  (see "Go-live" below).
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
- **Running now (as of 2026-07-01):** `medusa.service` + `medusa-worker.service` →
  `~/eshop/apps/backend/.medusa/server` (**eshop build, HEAD `234b1ba`**),
  `health=200`, Redis modules connected. Packeta provider loaded with **dummy
  creds** (see TL;DR) → no live Packeta calls possible.
- **mente-backend is stopped** (its `~/medusa/mente-backend/...` build is intact
  and can be re-pointed via the same unit-swap if ever needed).
- eshop `.env` (`~/eshop/apps/backend/.env`, copied into `.medusa/server/.env`):
  `DATABASE_URL` (db `medusa-mente-backend`) + `REDIS_URL` + dummy `PACKETA_*`.
  **Note:** `medusa build` wipes `.medusa/server`, so `.env` must be re-copied
  into `.medusa/server/` after every rebuild.
- **systemd units** are staged in `~/medusa-units/*.service` (now eshop-targeted,
  `ExecStart` = the pnpm sh-shim with **no** `node` prefix). Install them with the
  two exact NOPASSWD commands (a multi-file `cp` is NOT covered by sudoers):
  `sudo -n /usr/bin/cp /home/reet/medusa-units/medusa.service /etc/systemd/system/medusa.service`
  (and the `-worker` twin), then `sudo -n /usr/bin/systemctl daemon-reload`.
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
pool. Fix `8e0becf` adds the Redis modules. The last rebuild ran _before_ this
commit landed (a 4-min SSH timeout cut the `git reset` short), so the server build
still lacks it.

## Go-live: restore real Packeta creds (do ONLY when ready + account approved)

The backend is already deployed and running; going live is just swapping the
dummy creds back to the real ones and restarting. On the server:

```bash
ENV=~/eshop/apps/backend/.env
# Real values live in local C:\eshop\.env.local:
#   PACKETA_API_KEY     (local .env.local: PACKETA_API_KEY)
#   PACKETA_API_PASSWORD(local .env.local: PACKETA_API_SECRET)   # note name mapping
sed -i -E "s|^PACKETA_API_KEY=.*|PACKETA_API_KEY=<real-key>|"        "$ENV"
sed -i -E "s|^PACKETA_API_PASSWORD=.*|PACKETA_API_PASSWORD=<real-pw>|" "$ENV"
sed -i -E "s|^PACKETA_VALIDATE_POINT=.*|PACKETA_VALIDATE_POINT=true|"  "$ENV"
cp "$ENV" ~/eshop/apps/backend/.medusa/server/.env                   # build wipes this — re-copy
sudo -n /usr/bin/systemctl restart medusa.service medusa-worker.service
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:9000/health # want 200
```

Then the selection flow is fully live: storefront → CZK cart → checkout → select
**Packeta pickup point** → widget opens → pick a point → lands in cart shipping
`data` (`pickup_point_*`) → **Continue** enables. Only run admin "Create
fulfillment" (→ live `createPacket`) once the Packeta account is approved.

### Still TODO for a full browser e2e

- **Storefront:** decided to **use the basic Medusa starter** (`apps/storefront`,
  `@medusa-cz/demo-storefront`) for now; a custom design is deferred. Configured
  for **local dev against the deployed server backend** (2026-07-01) —
  `apps/storefront/.env.local` (gitignored):
  - `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` = server backend's Default key (`pk_927d…`).
  - `NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://192.168.0.156:9000` (LAN; backend is
    reachable, `health=200`). `STORE_CORS` already allows `http://localhost:8000`.
  - `NEXT_PUBLIC_DEFAULT_REGION=cz` (Czechia/CZK — the seeded Packeta region;
    the starter's `dk` maps to Europe/EUR and would hide Packeta).
  - `NEXT_PUBLIC_PACKETA_API_KEY` = **public** widget key (`77ad…`) — opens the
    picker + validates a point, **cannot** create a packet. The packet-triggering
    secret stays disabled server-side.
  - Verified: `pnpm dev` → `http://localhost:8000/cz` renders 200, pulls
    regions/collections/categories from the backend; 4 demo products present.
  - **Not yet server-deployed** (runs locally for now). Server deploy (build +
    systemd + real domain/CORS) is a later step if a hosted demo is wanted.
- ~~Delete the dead Coolify demo backend.~~ **DONE (2026-07-01):** removed the demo
  app (`i8s78go8…`), its Postgres (`r12vnn8…`, DB `medusa_demo`) + volume, and its
  Redis (`onwdnyjnwg38…`) + volume. Live infra (`medusa-postgres-1`,
  `medusa-redis-1`) untouched. A stale resource entry may still show in the Coolify
  **UI** — delete it there with one click to purge Coolify's own records.
- After Packeta approval (~3 days): restore real creds (see "Go-live" above),
  re-run Path A, then the full admin create-fulfillment → label → tracking →
  cancel round-trip.

## Gotchas captured

- pnpm `node_modules/.bin/medusa` is an **sh shim** — run it directly, never
  `node <shim>` (npm hoists a JS symlink, pnpm does not).
- Workspace plugins resolve from `apps/backend/node_modules/@medusa-cz/*` at
  runtime; `.medusa/server/node_modules/@medusa-cz` is expected to be empty.
- Bare-metal flat `.medusa/server` avoids the §13 container migrate-hang.
