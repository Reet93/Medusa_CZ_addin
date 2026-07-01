# Handover — M2 Packeta (backend + storefront + server deploy)

_Last updated: 2026-07-01. Branch: `master` (solo, no branches — see CLAUDE.md)._

## TL;DR — where things stand

- **M2 code is complete and on `master`, CI green.** Packeta fulfillment provider
  (M2a) + storefront Widget v6 selection flow (M2b) are done and **verified
  end-to-end in a browser** (see below).
- **Backend is deployed and healthy on the server.** The eshop build runs via
  systemd, `health=200`, Redis modules connected (the `53300` pool-timeout boot
  loop is gone). It replaced the old vanilla `mente-backend`.
- **Packeta is deployed but NEUTERED — it physically cannot fire a packet.** The
  server `.env` has **dummy** `PACKETA_API_KEY` / `PACKETA_API_PASSWORD` +
  `PACKETA_VALIDATE_POINT=false`. The provider loads but has no valid secret. The
  storefront uses the **public** widget key only (opens the map / selects a point —
  cannot create a packet).
- **Blocked only on Packeta account approval (~3 days from 2026-06-30)** for the
  live `createPacket` round-trip, and on **Comgate/GoPay accounts** for the payment
  step. Neither is needed for the selection flow, which already works.
- **Secret is not leaked** (0 commits, 0 tracked files; lives only in gitignored
  `.env` files). Real keys are in local `C:\eshop\.env.local`.

## What changed today (2026-07-01)

All pushed to `master`:

- **Deployed the Redis fix + cut the server over to eshop.** Stopped
  `mente-backend`, rebuilt eshop, repointed systemd, started → `health=200`, Redis
  cache/event-bus/workflow-engine all "established". (Fix commit was `8e0becf`.)
- **Neutered Packeta on the box** (dummy creds + `PACKETA_VALIDATE_POINT=false`).
- **Deleted the dead Coolify demo** (app `i8s78go8…`, Postgres `r12vnn8…`/`medusa_demo`,
  Redis `onwdnyjnwg38…`, all volumes). Live infra untouched.
- **Adopted the basic Medusa storefront** (`apps/storefront`) and configured it for
  local dev against the server backend. Custom design deferred.
- **Fixed three checkout bugs** found while first exercising the flow (details in
  "Checkout bugs fixed" below): `e9873c9` (storefront ordering) and `d5d5516`
  (seed: fulfillment links + CZK prices).
- **Verified the full selection flow in a browser** (Playwright): add to cart →
  checkout → CZ address → Packeta option (79 Kč) → widget opens → pick point →
  Continue enables. Zero errors, no packet fired.

## Links (server on LAN `192.168.0.156`, Tailscale `100.122.226.7`)

- **Backend API/health:** `http://192.168.0.156:9000` (TS: `http://100.122.226.7:9000`)
- **Backend admin:** `http://192.168.0.156:9000/app` (TS: `…100.122.226.7:9000/app`)
- **Storefront (local dev, this machine only):** `http://localhost:8000` — Czech
  region `http://localhost:8000/cz`. Runs only while `pnpm dev` is up in
  `apps/storefront`.
- **Coolify UI:** `http://192.168.0.156:8000` (TS: `…100.122.226.7:8000`). May still
  list a stale demo entry — one click to delete there.
- **SSH:** `C:\Users\sosno\OneDrive\Plocha\connect-server.bat` (LAN → Tailscale
  fallback). Non-interactive: `ssh reet@192.168.0.156`.

## Credentials & safety

- Packeta **apiKey** (public, 16-char) + **apiPassword** (secret, 32-char) live only
  in local `C:\eshop\.env.local` (gitignored) — keys named `PACKETA_API_KEY` /
  `PACKETA_API_SECRET`.
- Server `~/eshop/apps/backend/.env` currently holds **dummy** `PACKETA_API_KEY` /
  `PACKETA_API_PASSWORD` (`DISABLED_no_*_on_box`) + `PACKETA_VALIDATE_POINT=false`.
- Storefront `apps/storefront/.env.local` holds the **public** widget key
  (`NEXT_PUBLIC_PACKETA_API_KEY`) — read-only, cannot create a packet.
- Verified: neither real value is in any git commit or tracked file.

## Server state (bare-metal, reet-server)

- Node 20 via nvm; pnpm 9.15.0. **Running:** `medusa.service` + `medusa-worker.service`
  → `~/eshop/apps/backend/.medusa/server`, `health=200`, Redis connected, Packeta
  provider loaded with dummy creds (no live calls possible).
- **Running build is from HEAD `234b1ba`.** The repo working tree was later fast-
  forwarded to latest `master` to pick up the seed fix, but **no rebuild was needed**
  (the newer commits don't touch backend runtime/`medusa-config.ts`). Only rebuild
  (`npx medusa build` in `apps/backend`, then re-copy `.env` into `.medusa/server/`)
  if backend source/config changes.
- **`mente-backend` is stopped** (its build under `~/medusa/mente-backend/…` is
  intact; re-pointable via the same unit swap if ever needed).
- eshop `.env` (also copied into `.medusa/server/.env`): `DATABASE_URL` (db
  `medusa-mente-backend`) + `REDIS_URL=redis://localhost:6379` (→ `medusa-redis-1`)
  - dummy `PACKETA_*`. **`medusa build` wipes `.medusa/server`, so `.env` must be
    re-copied into it after every rebuild.**
- **systemd units** staged in `~/medusa-units/*.service` (eshop-targeted; `ExecStart`
  is the pnpm sh-shim with **no** `node` prefix). Install via the two exact NOPASSWD
  commands (a multi-file `cp` is NOT covered by sudoers):
  `sudo -n /usr/bin/cp /home/reet/medusa-units/medusa.service /etc/systemd/system/medusa.service`
  (and the `-worker` twin), then `sudo -n /usr/bin/systemctl daemon-reload`.
- **DB `medusa-mente-backend` seeded and working** (via `seed-packeta.ts`, idempotent):
  region **Czechia / czk**; shipping option **"Packeta pickup point" |
  `packeta_packeta` | calculated**; provider linked to the `European Warehouse` stock
  location; all 20 demo variants have CZK prices.
- **`max_connections` raised 50 → 200** in `~/medusa/docker-compose.yml` (postgres
  recreated; data persisted).
- **Coolify demo deleted** (2026-07-01). Coolify itself + `medusa-postgres-1` /
  `medusa-redis-1` untouched.

## Storefront (basic Medusa starter)

`apps/storefront` (`@medusa-cz/demo-storefront`), port 8000. Custom design deferred.
Configured for **local dev against the server backend** — `apps/storefront/.env.local`
(gitignored):

- `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` = server backend's Default key (`pk_927d…`).
- `NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://192.168.0.156:9000` (LAN reachable;
  `STORE_CORS` already allows `http://localhost:8000`).
- `NEXT_PUBLIC_DEFAULT_REGION=cz` (Czechia/CZK; the starter's `dk` maps to Europe/EUR
  and would hide Packeta).
- `NEXT_PUBLIC_PACKETA_API_KEY` = public widget key (`77ad…`).

Run: `cd apps/storefront && pnpm dev` → `http://localhost:8000/cz`. **Not yet
server-deployed** (a hosted demo would need: build on server, systemd unit, real
domain + CORS). Selection flow verified end-to-end in the browser.

## Checkout bugs fixed today (2026-07-01)

Three real bugs surfaced while first exercising checkout. All fixed; the two backend
ones are folded into `seed-packeta.ts` so a fresh DB/re-seed just works (verified by
deleting the links + a price and re-running the seed — idempotent):

- **Storefront ordering (`e9873c9`):** selecting the Packeta option called
  `setShippingMethod` with no `pickup_point_id` → provider `validateFulfillmentData`
  threw → delivery step 500'd on every click (only worked if you raced the widget
  open). Fix: defer persisting the Packeta method until a point is chosen
  (`onPacketaSelected`).
- **Seed gap A — no CZK prices (`d5d5516`):** demo products had EUR/USD prices only,
  so the CZK region rendered everything "out of stock" (`calculated_price: null`).
  The seed now derives a CZK price (EUR×25, e.g. €10→250 Kč) for every variant
  lacking one, via the Pricing module.
- **Seed gap B — Packeta fulfillment not linked to the location (`d5d5516`):** the
  `packeta-set` fulfillment set + `packeta_packeta` provider were never linked to the
  stock location serving the Default Sales Channel, so **no** shipping option
  appeared. The seed now creates the `location_fulfillment_set` +
  `location_fulfillment_provider` links (via the Link module) for every stock
  location.

## Go-live: restore real Packeta creds (ONLY when ready + account approved)

The backend is already deployed; going live = swap the dummy creds for real ones and
restart. On the server:

```bash
ENV=~/eshop/apps/backend/.env
# Real values live in local C:\eshop\.env.local:
#   PACKETA_API_KEY      (local .env.local: PACKETA_API_KEY)
#   PACKETA_API_PASSWORD (local .env.local: PACKETA_API_SECRET)   # note name mapping
sed -i -E "s|^PACKETA_API_KEY=.*|PACKETA_API_KEY=<real-key>|"          "$ENV"
sed -i -E "s|^PACKETA_API_PASSWORD=.*|PACKETA_API_PASSWORD=<real-pw>|" "$ENV"
sed -i -E "s|^PACKETA_VALIDATE_POINT=.*|PACKETA_VALIDATE_POINT=true|"  "$ENV"
cp "$ENV" ~/eshop/apps/backend/.medusa/server/.env                    # build wipes this — re-copy
sudo -n /usr/bin/systemctl restart medusa.service medusa-worker.service
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:9000/health  # want 200
```

## Next steps / still open

- **Wait for Packeta account approval (~3 days from 2026-06-30).** Then restore real
  creds (above), re-run the Path A probe (`scratchpad/packeta-pathA.mjs`), then the
  full admin **create-fulfillment → label → tracking → cancel** round-trip.
- **Payment step is untested** — needs **Comgate/GoPay** accounts (not yet available).
  Checkout works up to payment; that's the next milestone.
- **Optional:** deploy the storefront to the server for a hosted demo; delete the
  stale Coolify UI entry.

## Gotchas captured

- pnpm `node_modules/.bin/medusa` is an **sh shim** — run it directly, never
  `node <shim>` (npm hoists a JS symlink, pnpm does not).
- `medusa build` wipes `.medusa/server` → re-copy `apps/backend/.env` into
  `.medusa/server/.env` afterward (that's where Medusa loads env from at runtime).
- Passwordless sudo is scoped: `sudo -n /usr/bin/systemctl …` works, but `cp` only
  matches the two exact `~/medusa-units/*.service → /etc/systemd/system/…` commands.
- Storefront region must be `cz` — `dk`/EUR hides the Packeta (CZ-only) option.
- Workspace plugins resolve from `apps/backend/node_modules/@medusa-cz/*` at runtime;
  `.medusa/server/node_modules/@medusa-cz` is expected to be empty.
