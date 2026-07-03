'use strict';
/**
 * Resumable bulk translation of every page on a site, for one or all languages.
 *
 * Safe for very large sites (~21k pages): checkpoints progress to disk, retries
 * transient failures with backoff, re-triggers jobs the server lost on restart,
 * and supports hard caps on jobs/tokens plus a dry run.
 *
 * Usage:
 *   ADMIN_SECRET=... node api/scripts/translate-all-pages.js --site=temp
 *   ... --lang=ru                # single language (default: all enabled)
 *   ... --concurrency=3          # pages processed in parallel (default 3)
 *   ... --force                  # re-translate even if cached
 *   ... --limit=100              # only the first N pages (smoke test)
 *   ... --max-jobs=500           # stop after N page×lang jobs
 *   ... --max-tokens=2000000     # stop once this many tokens have been spent
 *   ... --dry-run                # count work, translate nothing
 *   ... --checkpoint=path.json   # resume file (default ./bt-checkpoint-<site>.json)
 *   ... --reset                  # ignore/overwrite an existing checkpoint
 */
const jwt   = require('jsonwebtoken');
const axios = require('axios');
const fs    = require('fs');

const arg = (k, d) => { const a = process.argv.slice(2).find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const flag = (k) => process.argv.slice(2).includes('--' + k);

const API         = process.env.BT_API_URL || 'https://binayah-translation-api.onrender.com';
const SECRET      = process.env.ADMIN_SECRET;
if (!SECRET) { console.error('ADMIN_SECRET env var required.'); process.exit(1); }
const TOKEN       = jwt.sign({ id: 'superadmin', role: 'superadmin', username: 'admin' }, SECRET, { expiresIn: '24h' });
const H           = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };

const SITE        = arg('site', 'temp');
const LANG        = arg('lang', 'all');
const CONCURRENCY = Math.max(1, parseInt(arg('concurrency', '3'), 10));
const FORCE       = flag('force');
const LIMIT       = arg('limit') ? parseInt(arg('limit'), 10) : Infinity;
const MAX_JOBS    = arg('max-jobs') ? parseInt(arg('max-jobs'), 10) : Infinity;
const MAX_TOKENS  = arg('max-tokens') ? parseInt(arg('max-tokens'), 10) : Infinity;
const DRY_RUN     = flag('dry-run');
const CKPT        = arg('checkpoint', `./bt-checkpoint-${SITE}.json`);
const RESET       = flag('reset');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── retry wrapper with exponential backoff ──────────────────────────────────
async function withRetry(fn, label, tries = 5) {
  let delay = 2000;
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); }
    catch (e) {
      const status = e.response?.status;
      if (i === tries) { console.warn(`  ! ${label} failed after ${tries} tries: ${status || e.message}`); return null; }
      // 4xx (except 429) are not worth retrying
      if (status && status >= 400 && status < 500 && status !== 429) { console.warn(`  ! ${label}: ${status} (no retry)`); return null; }
      await sleep(delay); delay = Math.min(delay * 2, 30000);
    }
  }
}

// ── checkpoint (set of "postId:lang" completed) ─────────────────────────────
let done = new Set();
function loadCkpt() {
  if (RESET) return;
  try { const d = JSON.parse(fs.readFileSync(CKPT, 'utf8')); (d.done || []).forEach(k => done.add(k)); }
  catch { /* fresh run */ }
}
let _saveTimer = null;
function saveCkpt() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    const tmp = CKPT + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify({ site: SITE, done: [...done] })); fs.renameSync(tmp, CKPT); } catch {}
  }, 1000);
}
function saveCkptNow() {
  try { fs.writeFileSync(CKPT, JSON.stringify({ site: SITE, done: [...done] })); } catch {}
}

// ── API calls ───────────────────────────────────────────────────────────────
async function getEnabledLangs() {
  const r = await withRetry(() => axios.get(`${API}/languages/config`, { headers: H }), 'languages/config');
  return (r?.data || []).filter(l => l.enabled).map(l => l.code);
}
async function getPages(page, perPage) {
  const r = await withRetry(() => axios.get(`${API}/pages?env=${SITE}&page=${page}&per_page=${perPage}`, { headers: H }), `pages p${page}`);
  return r?.data || null;
}
async function trigger(pageId, lang) {
  const r = await withRetry(() => axios.post(`${API}/translate/page/async`,
    { page_id: pageId, language: lang, force: FORCE, env: SITE }, { headers: H }), `trigger ${pageId}/${lang}`);
  return r?.data?.job_id || null;
}
async function progress(jobId) {
  const r = await withRetry(() => axios.get(`${API}/translate/progress/${jobId}`, { headers: H }), `progress ${jobId}`, 3);
  return r?.data || null;
}

// Run one page×lang to completion. Handles jobs the server lost on restart
// (status not_found / interrupted) by re-triggering, up to a few attempts.
let tokensSpent = 0;
async function translateOne(pageId, lang) {
  const key = `${pageId}:${lang}`;
  if (done.has(key)) return 'skip';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const jobId = await trigger(pageId, lang);
    if (!jobId) return 'error';
    for (let i = 0; i < 400; i++) {
      await sleep(3000);
      const j = await progress(jobId);
      if (!j) continue;
      if (j.status === 'not_found' || j.status === 'interrupted') break; // server lost it → re-trigger
      if (j.status === 'done') {
        for (const r of (j.results || [])) tokensSpent += r.tokens_used || 0;
        done.add(key); saveCkpt();
        return 'done';
      }
      if (j.status === 'error') { console.warn(`  ! ${key}: ${j.error || 'error'}`); done.add(key); saveCkpt(); return 'error'; }
      if (j.status === 'stopped') return 'stopped';
    }
  }
  console.warn(`  ! ${key}: gave up after re-triggers`);
  return 'lost';
}

// ── main ────────────────────────────────────────────────────────────────────
(async () => {
  loadCkpt();
  const langs = LANG === 'all' ? await getEnabledLangs() : [LANG];
  if (!langs.length) { console.error('No languages resolved.'); process.exit(1); }
  console.log(`Site=${SITE} langs=${langs.join(',')} concurrency=${CONCURRENCY} force=${FORCE} dryRun=${DRY_RUN}`);
  console.log(`Checkpoint=${CKPT} (already done: ${done.size})`);
  if (MAX_JOBS !== Infinity) console.log(`Cap: max ${MAX_JOBS} jobs`);
  if (MAX_TOKENS !== Infinity) console.log(`Cap: max ${MAX_TOKENS} tokens`);

  process.on('SIGINT', () => { console.log('\nInterrupted — saving checkpoint.'); saveCkptNow(); process.exit(130); });

  // 1. Global bucket (post_id=0: nav + theme strings) first, once per language.
  if (!DRY_RUN) {
    for (const lang of langs) { if (!done.has(`0:${lang}`)) { process.stdout.write(`[global ${lang}] `); console.log(await translateOne(0, lang)); } }
  }

  // 2. Paginate all pages, process concurrently, honoring caps + checkpoint.
  const PER_PAGE = 50;
  let page = 1, totalPages = 1, total = 0, processed = 0, jobs = 0;
  const start = Date.now();
  const queue = [];

  const drain = async () => {
    // process the queue with a fixed concurrency window
    let idx = 0;
    async function worker() {
      while (idx < queue.length) {
        const { pid, lang } = queue[idx++];
        if (jobs >= MAX_JOBS || tokensSpent >= MAX_TOKENS) return;
        const res = await translateOne(pid, lang);
        if (res === 'done' || res === 'error') jobs++;
        processed++;
        if (processed % 10 === 0 || res !== 'skip') {
          const mins = ((Date.now() - start) / 60000).toFixed(1);
          process.stdout.write(`\r  ${processed} page-langs | ${jobs} jobs | ${Math.round(tokensSpent/1000)}k tok | ${mins}min   `);
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  };

  while (page <= totalPages) {
    const data = await getPages(page, PER_PAGE);
    if (!data || !data.data) break;
    totalPages = Math.min(data.total_pages || 1, Math.ceil(LIMIT / PER_PAGE) || 1);
    total = data.total || 0;
    const items = (data.data || []).filter(p => p.post_id > 0).slice(0, Math.max(0, LIMIT - (page - 1) * PER_PAGE));

    for (const p of items) for (const lang of langs) queue.push({ pid: p.post_id, lang });
    page++;
    if ((page - 1) * PER_PAGE >= LIMIT) break;
  }

  console.log(`\nTotal site pages: ${total}. Queued page-langs: ${queue.length} (excludes ${done.size} already done).`);
  if (DRY_RUN) { console.log('Dry run — nothing translated.'); return; }

  await drain();
  saveCkptNow();

  const capped = jobs >= MAX_JOBS || tokensSpent >= MAX_TOKENS;
  console.log(`\n\n${capped ? 'Stopped at cap' : 'Complete'}: ${jobs} jobs, ~${Math.round(tokensSpent/1000)}k tokens, ${done.size} page-langs done.`);
  if (capped) console.log('Re-run the same command to resume from the checkpoint.');
})().catch(e => { console.error(e.message); saveCkptNow(); process.exit(1); });
