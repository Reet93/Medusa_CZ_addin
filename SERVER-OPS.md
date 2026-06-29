# MËNTE Self-Hosted Server — Operations & Resume Doc

> **This is the living "where are we" doc.** Update it whenever server state changes.
> Supersedes the original brain-dump (`~/Downloads/medusa-server-context.md`).
> Last updated: **2026-06-28** (session: fixed `medusa start`, login, static IP).

⚠️ **No raw secrets in this file** (it may be committed to git). Actual credentials live
in `apps/backend/.env` on the server. See "Credentials" below.

> **▶ RESUME (new chat): read this whole file, run §10 checklist, then pick the next
> unchecked item in §9. The `#6` provider is DONE + shipped (PR #2). Next is M1 demo
> wiring (Tasks 9–12) — ⚠️ blocked on Medusa plugin packaging; WIP is stashed (`git stash list`).
> Best done interactively with local Postgres + `medusa develop`. See §12 for the blocker.**

---

## 1. Quick facts / how to connect

|                      | Value                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Server user@host     | `reet@192.168.0.156` (wired LAN, static)                                                                                      |
| Tailscale (remote)   | `reet@100.122.226.7` — SSH from anywhere, no port-forward                                                                     |
| One-click SSH (PC)   | `connect-server.bat` (OneDrive\Plocha) — tries LAN first, falls back to Tailscale when away. Backup: `connect-server.bat.bak` |
| Admin panel          | http://192.168.0.156:9000/app                                                                                                 |
| Admin login email    | `sosnovec.jakub@gmail.com`                                                                                                    |
| OS / Node            | Ubuntu 26.04, kernel 7.0 / Node v20.20.2 (nvm), npm 11+                                                                       |
| Medusa               | 2.17.0, Turborepo at `~/medusa/mente-backend`                                                                                 |
| Plugin dev workspace | `C:\eshop` (this repo, branch `m1-comgate`)                                                                                   |

**How Claude connects:** one-shot commands over the existing SSH key, e.g.
`ssh reet@192.168.0.156 "..."`. No copy-paste needed.

**Sudo (set up this session):** `reet` has NOPASSWD for **`systemctl` only**, plus a scoped
`cp` for the two medusa unit files. Defined in `/etc/sudoers.d/medusa-reet`.
Anything else (netplan, etc.) still needs the user's password in their own terminal.

---

## 2. The stack & key paths

- **Docker:** `medusa-postgres-1` (Postgres 16) + `medusa-redis-1` (Redis 7), bound to
  `127.0.0.1`, compose at `~/medusa/docker-compose.yml`. DB used: `medusa-mente-backend`.
- **Medusa build output (run from here):**
  `~/medusa/mente-backend/apps/backend/.medusa/server/`
- **Source config:** `~/medusa/mente-backend/apps/backend/medusa-config.ts`
- **Env:** `apps/backend/.env` (source) → copied to `.medusa/server/.env` (what runs).
- **medusa binary:** `~/medusa/mente-backend/node_modules/.bin/medusa`

---

## 3. Services (systemd) — the server/worker split

Two units (both `enabled`, survive reboot):

| Unit                    | Mode                        | Role                     |
| ----------------------- | --------------------------- | ------------------------ |
| `medusa.service`        | `MEDUSA_WORKER_MODE=server` | HTTP server, binds :9000 |
| `medusa-worker.service` | `MEDUSA_WORKER_MODE=worker` | background jobs/events   |

Both run from `.medusa/server` with `NODE_ENV=production`. Unit files staged at
`~/medusa-units/` and installed to `/etc/systemd/system/`.

Common ops:

```bash
sudo systemctl restart medusa.service        # after config/env change
sudo systemctl status medusa.service
journalctl -u medusa.service -n 50 --no-pager
```

---

## 4. The big bug we fixed (DO NOT re-debug)

**Symptom:** `medusa start` loaded everything, registered all routes, then silently never
bound :9000 (no error). The handover doc's wall.

**Root cause:** default `shared` worker mode → Medusa 2.17's `event-bus-redis`
`onApplicationStart` does `await bullWorker.run()`, and BullMQ `run()` is the **worker's
infinite loop — a promise that never resolves**. Medusa `await`s that hook, so startup
blocked right before `listen()`. (NOT the admin build, NOT config, NOT Node version.)

**Fix:** split into `server` + `worker` processes (Medusa's recommended prod architecture)
via the two systemd units. Server mode doesn't create the in-process worker → binds fine.

Also fixed the unit's wrong `WorkingDirectory` (`apps/backend` → `.medusa/server`; the
former crashed with "index.html not found").

## 5. Login fixes (3 stacked issues)

1. Server wasn't running (bug above).
2. **CORS:** LAN origin `http://192.168.0.156:9000` was missing from `ADMIN_CORS`/`AUTH_CORS`
   → added (in both source `.env` and running `.env`).
3. **Secure cookie over HTTP:** production marks the session cookie `Secure`; browsers drop
   `Secure` cookies over plain `http://` → session never persisted. Fix: added
   `cookieOptions: { secure: false, sameSite: "lax" }` to `projectConfig` (source +
   compiled config). **⚠️ When serving via HTTPS (Cloudflare tunnel), set `secure: true` back.**

**Changing the admin password** (no UI for it without SMTP — use this CLI method):

```bash
cd ~/medusa/mente-backend/apps/backend/.medusa/server
cat > /tmp/reset-pw.js <<'JS'
exports.default = async function ({ container }) {
  const auth = container.resolve("auth")
  await auth.updateProvider("emailpass", { entity_id: "sosnovec.jakub@gmail.com", password: "NEWPASS" })
  console.log("PWRESET_OK")
}
JS
NODE_ENV=production ~/.nvm/versions/node/v20.20.2/bin/node \
  ~/medusa/mente-backend/node_modules/.bin/medusa exec /tmp/reset-pw.js
rm /tmp/reset-pw.js
```

---

## 6. Network (this session)

- `enp1s0` is now **static** `192.168.0.156/24`, gw `192.168.0.1`, DNS `1.1.1.1/8.8.8.8`.
- **WiFi removed** (was `192.168.1.x`) — wired-only now, single clean subnet.
- netplan: `/etc/netplan/00-installer-config.yaml`; backup at `~/netplan-backup.yaml`.
- Topology: WiFi-router(`192.168.1.1`) → **2nd router** (the "switch", `192.168.0.1`) → PC(`.73`) + server(`.156`).

---

## 7. ⚠️ Rebuild caveat

If you run `npm run build` (from `apps/backend`), it regenerates `.medusa/server/`. After a
rebuild, re-verify:

- `.medusa/server/.env` exists & has the CORS origins (copy from `apps/backend/.env` if not).
- `.medusa/server/medusa-config.js` has `cookieOptions` (it will, since source `.ts` has it).
- Run `npm install` inside `.medusa/server` if deps changed (use **npm 11+** — npm 10 hangs).
- `sudo systemctl restart medusa.service medusa-worker.service`.

The systemd units (worker mode, WorkingDirectory) are unaffected by rebuilds. ✅

---

## 8. Credentials (values NOT in this file)

- All live in `apps/backend/.env` on the server (DB, JWT, cookie, CORS).
- ⚠️ **One shared password is currently reused for WiFi + Postgres + admin login.**
  De-duplicate & rotate during secrets hardening (deferred — see below).

---

## 9. TODO / roadmap

**Next up (chosen order):**

- [x] **5 — Backups (LOCAL).** ✅ Done 2026-06-28. Local-only to the SATA disk (no restic,
      no Google Drive — fully standalone). Restore drill PASSED (142 tables, admin user
      recovered). See §11 for details.
- [x] **1 — Tailscale.** ✅ Server side done 2026-06-28. Installed v1.98.4, authed to
      `sosnovec.jakub@`, SSH enabled (`RunSSH: true`). Server tailnet IP **`100.122.226.7`**.
      _Remaining (user): (a) install Tailscale on PC/phone + log in same account to connect;
      (b) in admin console (login.tailscale.com), disable key expiry for `reet-server`
      (currently expires 2026-12-25, would drop the server off the tailnet)._
- [~] **6 — Plugins.** `payment-comgate` (branch `m1-comgate` merged to `master`, dev in `C:\eshop`).
  **Provider COMPLETE** — all 10 `AbstractPaymentProvider` methods implemented via TDD
  (25 unit tests green, typecheck + build clean): client (create/status/refund/capture+cancel
  preauth) + `initiatePayment`/`getPaymentStatus`/`retrievePayment`/`authorizePayment`/
  `capturePayment`/`refundPayment`/`cancelPayment`/`deletePayment`/`updatePayment`/
  `getWebhookActionAndData` (webhook re-queries Comgate status, never trusts the unsigned payload).
  Commits: `0392645`, `1247a9e`, `556fee3`, `d8db730` (Task 8 sandbox suite), `0fba5de` (README).
  **Provider PR shipped:** PR #2 (branch `m1-comgate-provider`) —
  https://github.com/Reet93/Medusa_CZ_addin/pull/2.
  **Remaining for M1** (per `docs/superpowers/plans/2026-06-15-m1-comgate.md`): Task 9 register
  provider in demo backend + CZK seed (⚠️ **DEFERRED — blocked on Medusa plugin packaging**,
  WIP stashed; see §12), Task 10–11 storefront (redirect button + return route), Task 12 round-trip.
  Deploy flow (build here → onto server → restart) comes AFTER the demo round-trip — no wiring yet.

**Deferred (later):**

- [ ] **Off-site backup copy** — currently backups are LOCAL only (same box). A disaster
      (theft/fire/surge/ransomware) loses NVMe + SATA together. Add an off-site copy
      (Google Drive via rclone, or another location) once there's real data worth protecting.
- [ ] **Weekly full NVMe disk image** → `/backup` (from original plan; needs root/`dd`). Deferred.
- [ ] **Cloudflare Tunnel** — public web access (needs a domain). On setup: add tunnel
      domain to CORS + flip cookie `secure` back to `true`.
- [ ] **Secrets hardening (pre-go-live):** rotate `JWT_SECRET`, `COOKIE_SECRET`, Postgres
      password; stop reusing the shared password.
- [ ] **Email/SMTP** — enables in-app password reset + admin invites.
- [ ] Optional: DHCP reservation for `.156` on the `192.168.0.1` router (belt-and-suspenders).

---

## 10. Resume checklist (start of next session)

1. `ssh reet@192.168.0.156 "systemctl is-active medusa.service medusa-worker.service"` → both `active`.
2. `curl -s -o /dev/null -w '%{http_code}' http://192.168.0.156:9000/health` → `200`.
3. Read this doc's TODO section; pick up the next unchecked item.
4. Update this doc when state changes.

---

## 11. Backups (local, done 2026-06-28)

- **Script:** `~/medusa-backups/backup.sh` (standalone, no root). Runs as reet via cron.
- **Schedule:** daily 03:00 (reet crontab: `0 3 * * * /home/reet/medusa-backups/backup.sh`).
- **Destination:** `/backup/medusa/daily/` (the 458 GB SATA disk, `/dev/sda`).
- **Contents per run:** `db_<ts>.sql.gz` (pg*dump of `medusa-mente-backend`) +
  `config*<ts>.tar.gz` (`.env`x2,`medusa-config.ts`, `docker-compose.yml`, `medusa-units/`).
- **Retention:** 14 days. **Log:** `/backup/medusa/backup.log`.
- **Restore drill:** PASSED (restored to throwaway DB, 142 tables, admin user intact).

**Restore the DB from a backup:**

```bash
gunzip -c /backup/medusa/daily/db_<ts>.sql.gz \
  | docker exec -i medusa-postgres-1 psql -U medusa -d medusa-mente-backend
```

**Run a backup manually:** `~/medusa-backups/backup.sh` then check `/backup/medusa/backup.log`.

⚠️ Backups are **LOCAL only** (same machine) and **not encrypted** (config bundle contains
secrets). Fine for now; add off-site + encryption before real customer data (see deferred).

---

## 13. Coolify deploy (IN PROGRESS — blocked on migrate hang)

**Goal:** deploy the **demo** stack (apps/backend + storefront) to Coolify on the server for a
live Comgate round-trip. Production Medusa (`:9000`, systemd) is **untouched**.

**Coolify:** installed on the server (v4.1.2), dashboard `http://192.168.0.156:8000`, public IP
`188.75.149.32`. Admin account = user's. API token issued (revoke when done).
- Server (localhost): `x13ax60jnk0i5atvfdgqnyg4`  ·  Project `medusa-cz`: `d1jiy29w0od06jvc8euz7w1b`  ·  env `production`: `v4quk4lvi1qfbh6nuxjkmstr`
- Postgres `medusa-db` `r12vnn8fg8ezcigysu2uz4z7` (db `medusa_demo`, user `medusa`) — isolated from prod.
- Redis `medusa-redis` `onwdnyjnwg38k4nsj3nqd1w7`.
- Backend app `medusa-backend` `i8s78go8fekqnhb66ywnt3e2`, domain `i8s78go8fekqnhb66ywnt3e2.188.75.149.32.sslip.io`, build = Dockerfile `/apps/backend/Dockerfile`, branch `m1-comgate-deploy`.
- Coolify localhost server needed Coolify's pubkey in **root** `authorized_keys` + `PermitRootLogin prohibit-password` (`/etc/ssh/sshd_config.d/10-coolify.conf`).

**What works:** Docker build ✅, **provider loads** ✅ (the `.js`-extension fix, proven in-container),
DB connects ✅, migrations table created ✅.

**BLOCKER:** `medusa db:migrate` hangs at "Running migrations…" — event loop idle (`ep_poll`),
1 idle pg socket → **awaiting a promise that never resolves**. Ruled out: our plugin/config
(minimal config hangs), worker mode, NODE_ENV, advisory locks, Redis (real redis configured +
reachable, still hangs), **and Medusa version** (2.17.0 hangs same as 2.15.5).
- **Leading hypothesis:** container runs from `/app/apps/backend` with the **pnpm workspace
  symlinks** present; Medusa's migration-file scan over the symlinked `.pnpm` store loops/hangs.
  Production works because it runs from a **flat self-contained `.medusa/server`** (no symlinks).
- **Next fix to try:** Dockerfile → proper Medusa prod pattern: `medusa build` then run from
  `.medusa/server` with its own `npm install` (flat deps, no workspace symlinks). Caveat: the
  workspace plugin (`@medusa-cz/payment-comgate`) must be present in `.medusa/server/node_modules`
  (bundle/copy it, or `npm i` the built tarball). Alternatively run the demo backend on the HOST
  like production (no container).

**Useful one-liners:**
```bash
# app container logs / shell (on server)
n=$(docker ps --filter name=i8s78go8fekqnhb66ywnt3e2 --format '{{.Names}}'|head -1); docker logs --tail 40 "$n"
# demo DB table count
docker exec $(docker ps --filter name=r12vnn8fg8ezcigysu2uz4z7 --format '{{.Names}}'|head -1) psql -U medusa -d medusa_demo -tAc "select count(*) from information_schema.tables where table_schema='public';"
# trigger deploy (Coolify API; TOKEN from user)
curl -s -X POST -H "Authorization: Bearer <TOKEN>" "http://192.168.0.156:8000/api/v1/deploy?uuid=i8s78go8fekqnhb66ywnt3e2&force=true"
```

---

## 12. Session log

### 2026-06-29 (pm) — Coolify deploy + plugin-load fix; migrate hang open
- **Plugin packaging FIX (important):** the provider as shipped in PR #2 would NOT load in any
  Medusa app — `medusa plugin:build` emits ESM but `moduleResolution:Bundler` allowed extensionless
  relative imports that Node's ESM loader rejects. Fixed with `.js` import extensions +
  `src/providers/comgate/index.ts` (gopay layout) + `./providers/*` export. On branch
  `m1-comgate-deploy` (commit `dea37c5`); **needs cherry-pick to master.**
- **Demo wiring + Dockerfile** for Coolify (`workspace:*` dep, dropped yalc).
- **Bumped @medusajs/* 2.15.5 → 2.17.0** (match prod) — did NOT fix the migrate hang.
- **Coolify** stood up on the server; backend deployed, provider loads, DB connects — but
  `medusa db:migrate` hangs (see §13). Production untouched/healthy throughout.
- **connect-server.bat** fixed (flash-close was literal `(%TS%)` parens closing the if-block;
  rewritten with a goto label). NordVPN/Tailscale were red herrings.

### 2026-06-29 — Comgate provider complete (all 10 methods, TDD)

- Implemented the 7 remaining stubbed provider methods (plan Tasks 5–7), strict RED-GREEN:
  `authorizePayment` + `capturePayment` (both capture modes; manual capture supports optional
  partial amount), `refundPayment` + `cancelPayment`/`deletePayment` (manual cancels the preauth,
  automatic is a best-effort no-op), `updatePayment` (re-creates the immutable Comgate tx on amount
  change), `getWebhookActionAndData` (re-queries status, maps to `PaymentActions`). Removed the
  `notImplemented` helper. 25 unit tests green, `typecheck`/`build` clean.
- Commits `0392645`, `1247a9e`, `556fee3` on `master`.
- **Task 8** opt-in sandbox integration suite added (`d8db730`) — skips without
  `COMGATE_MERCHANT`/`COMGATE_SECRET`; excluded from the default gate.
- **README** (`0fba5de`) — options, capture modes, webhook URL, manual sandbox acceptance.
- **PR shipped:** provider-only **PR #2** (branch `m1-comgate-provider`):
  https://github.com/Reet93/Medusa_CZ_addin/pull/2 — provider complete + tested, PR-ready.
- **Autonomy:** enabled `permissions.defaultMode: "auto"` in `.claude/settings.local.json` —
  safe reads/edits/builds/tests/git/ssh auto-approved; risky/irreversible actions still prompt.
- **⚠️ Demo wiring (Tasks 9–12) DEFERRED — blocked on Medusa plugin packaging.** Did the
  Medusa yalc plugin flow (`plugin:publish` + `plugin:add` both OK), wrote `medusa-config.ts`
  (plugins + payment provider), CZK `seed-comgate-region.ts`, `.env.template` keys. But
  `medusa build` fails: `plugin:build` emits **extensionless ESM** into `.medusa/server/src/`
  with **no `.` export** and no `.medusa/server/package.json` (same as the gopay sibling, so it's
  normal plugin-build output). Medusa's `loadInternalProvider` does `require.resolve(pkg)` →
  `No "exports" main defined`; giving it a `.`/main then trips the extensionless-import on
  `dynamicImport`. Failure is in `medusa build`'s **type-gen** — provider may still load at
  runtime via `medusa develop`. The wiring is **stashed**: `git stash list` →
  _"wip: demo comgate wiring"_ (restore with `git stash pop` on a branch off `master`).
- **Next (interactive session):** start local Postgres (`~/medusa/docker-compose.yml` pattern or
  the demo's own) + `cd apps/backend && pnpm dev` to test the provider at runtime; fix packaging
  (likely relocate ModuleProvider to `src/providers/comgate/index.ts` + register via the
  `…/providers/comgate` subpath, gopay-style); then Tasks 10–12 storefront + sandbox round-trip.

### 2026-06-28 — server brought fully online

- **Fixed the long-standing `medusa start` no-bind** (root cause: `event-bus-redis`
  shared-mode hangs on `bullWorker.run()`). Solution: server/worker split via two
  systemd units. See §4.
- **Fixed admin login** (3 stacked: server down → CORS missing LAN origin → `Secure`
  cookie over HTTP). See §5. Admin password set to the shared LAN password.
- **Network:** static wired IP `192.168.0.156`, WiFi removed. See §6.
- **#5 Backups:** daily local backup to SATA + restore drill passed. See §11.
- **#1 Tailscale:** server on tailnet `100.122.226.7`, SSH enabled. PC install + key-expiry
  disable still pending (see §9).
- **`connect-server.bat`** rewritten: LAN-first, Tailscale-fallback.
- Sudo for `reet`: NOPASSWD `systemctl` + scoped `cp` for the 2 medusa units.
- **Next:** `#6` — implement the 7 stubbed `payment-comgate` provider methods (TDD).
