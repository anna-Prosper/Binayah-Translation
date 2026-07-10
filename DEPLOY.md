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
- **No `/data` backup** — single point of failure (all state + WP creds). Add a Render disk snapshot or an export cron.
- **No API CI** (tests/lint). `npm test` is a stub.
- **No admin healthcheck** in `render.yaml`.
- **Rate limiting** deferred — the WP server calls `/languages/geoip` per-visitor from one IP, so a naive per-IP limit would throttle the frontend; needs an allowlist.
