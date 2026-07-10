# Binayah Translation — Deploy & Ops Runbook

## Architecture
- **API** (`api/`) — Fastify service on Render. AI translation via DeepSeek/OpenRouter (raw `axios`). All state is flat JSON on the Render **persistent disk** (`DATA_DIR=/data`): `env-config.json` (WP site creds), `language-config.json`, `page-config.json`, `field-hashes.json`, `translation-cache.json`, `string-frequency.json`, `jobs.json`, `translation-log.jsonl`, `users.json`. No Redis/Postgres/queue.
- **Admin** (`admin/`) — Next.js on Render. Talks to the API through a `/api/*` rewrite (`NEXT_PUBLIC_API_URL`). Attaches the JWT to every `/api` call (`app/components/ApiAuth.tsx`).
- **Plugin** (`wordpress-plugin/`) — installed on each WP site. Extracts text, stores translations in a custom table, applies them via an output-buffer `strtr` map + nav-menu filters. Calls the API only for `/languages/*` (public) and self-registration.

## Environments
- **temp** — `https://binayah-temp.fixed-staging.co.uk`
- **staging** — `https://binayahcom.fixed-staging.co.uk`
- **prod** — not configured. To add: set `WP_KEY_PROD`, add it to `deploy-plugin.js` SITES + the GH workflow, register the site in the admin UI.

## Deploying
### API / Admin (Render)
Auto-deploys on push to `main` — **but only when files under each service's `rootDir` change** (`rootDir: api` / `rootDir: admin`). A plugin-only commit does **not** redeploy the API.

### WordPress plugin
Two ways:
1. **CI (preferred)** — `.github/workflows/deploy-plugin.yml` fires on any `wordpress-plugin/**` change and pushes to every site's `self-update` endpoint. Requires repo secrets **`WP_KEY_TEMP`**, **`WP_KEY_STAGING`**.
2. **Manual** — `WP_KEY_TEMP=<key> node api/scripts/deploy-plugin.js --site=temp` (first-ever install: add `--bootstrap --wp-user=<u> --wp-pass=<app-pass>`).
Always bump the version in `wordpress-plugin/binayah-translate.php` — the frontend cache key includes `BT_VERSION`, so bumping busts cached translation maps.

## Secrets (Render dashboard env; never in git)
`ADMIN_SECRET`, `JWT_SECRET`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, `ALLOWED_ORIGINS`, per-site WP `bt_api_key`. Local dev: `api/.env` (gitignored). Repo secrets for CI: `WP_KEY_TEMP`, `WP_KEY_STAGING`.

### Rotation order (avoid lockout)
1. Set a distinct **`JWT_SECRET`** first (decouples signing from the password). All sessions invalidate → log in again.
2. Then rotate **`ADMIN_SECRET`** (the login password) independently.
3. Rotate WP `bt_api_key` per site (WP admin → Binayah Translate settings) and update `WP_KEY_*` env/secrets.

## Running translations
- Admin UI → Translate (per page/language), or force-retranslate Global (nav+theme).
- Bulk: `ADMIN_SECRET=… node api/scripts/translate-all-pages.js --site=temp [--lang=ru] [--limit=N] [--max-tokens=N]`. Resumable via `bt-checkpoint-<site>.json`; safe to re-run. **Smoke-test with `--limit=20` first.**

## ⚠️ Operational gaps (todo)
- **No API CI** (tests/lint). `npm test` is a stub.

## Backups
Rotating zip snapshots of the whole `/data` disk run in-process (`api/lib/backup.js`): one shortly after boot, then every `BACKUP_INTERVAL_HOURS` (default 6), keeping the newest `BACKUP_KEEP` (default 48) under `/data/backups/`. This protects against corruption / bad writes / accidental wipes, but the snapshots live on the **same disk** — to also survive disk loss, pull them offsite.

Superadmin-only endpoints (JWT):
- `GET /backup/list` — list snapshots.
- `POST /backup/now` — snapshot immediately.
- `GET /backup/export` — snapshot now and stream the zip (use this for offsite pull).
- `GET /backup/download/:name` — stream an existing snapshot.

**Offsite cron (recommended):** from any always-on box, `curl -H "Authorization: Bearer <admin-jwt>" https://<api>/backup/export -o backup-$(date +%F).zip` on a daily schedule, shipped to S3/R2/Backblaze. Restore = unzip into `/data` and restart the service. Disable the in-process schedule with `BACKUP_INTERVAL_HOURS=0`.

## Rate limiting
`@fastify/rate-limit`, configured in `api/lib/rate-limit.js`. The design avoids throttling first-party traffic, which all arrives from a few fixed IPs (the WP server hits `/languages/*` per-visitor; the admin UI proxies every call through one Next.js server):
- **Exempt (never limited):** public plugin/probe paths (`/languages/*`, `/health`, `/`), any request with a valid admin JWT, and IPs in `RATE_LIMIT_ALLOWLIST`.
- **Limited:** anonymous, non-plugin callers at `RATE_LIMIT_MAX` req/min (default 300).
- **`/auth/login`:** strict `RATE_LIMIT_LOGIN_MAX` (default 15) per minute, keyed to a single global bucket so brute force can't be dodged by rotating source IPs (login is proxied through the admin server anyway).

Requires `trustProxy: true` (set in `index.js`) so `req.ip` is the real client IP behind Render's proxy. `RATE_LIMIT_ALLOWLIST` (comma-separated IPs) is optional belt-and-suspenders for the WP server.

## Deployed-version marker
`GET /` and `GET /health` return `commit` (= `RENDER_GIT_COMMIT`). A failed Render deploy leaves the previous commit serving, so compare this against `git rev-parse HEAD` to confirm what's actually live.
