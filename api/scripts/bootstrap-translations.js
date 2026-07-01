'use strict';
/**
 * Automated bootstrap translation:
 * 1. Force-translates the home page (all enabled languages) on both sites
 * 2. Translates Global (Nav Menus) — post_id=0 — on both sites
 *
 * Usage:
 *   node api/scripts/bootstrap-translations.js
 *   node api/scripts/bootstrap-translations.js --site=temp
 *   node api/scripts/bootstrap-translations.js --lang=ru   # single language only
 *   node api/scripts/bootstrap-translations.js --nav-only  # skip home page, only nav
 */
const axios = require('axios');

const API_BASE = 'https://binayah-translation-api.onrender.com';
const ADMIN_TOKEN = process.env.BT_ADMIN_TOKEN || '';

const args      = process.argv.slice(2);
const siteArg   = args.find(a => a.startsWith('--site='))?.split('=')[1];
const langArg   = args.find(a => a.startsWith('--lang='))?.split('=')[1] || 'all';
const navOnly   = args.includes('--nav-only');

const SITES = ['staging', 'temp'].filter(s => !siteArg || s === siteArg);

async function getToken() {
  if (ADMIN_TOKEN) return ADMIN_TOKEN;
  // Try to get a token from env or prompt
  const user = process.env.BT_ADMIN_USER || 'admin';
  const pass = process.env.BT_ADMIN_PASS || '';
  if (!pass) {
    console.error('Set BT_ADMIN_TOKEN or BT_ADMIN_USER+BT_ADMIN_PASS env vars');
    process.exit(1);
  }
  const res = await axios.post(`${API_BASE}/auth/login`, { username: user, password: pass });
  return res.data.token;
}

function headers(token) {
  return { Authorization: `Bearer ${token}` };
}

async function waitForJob(jobId, label, token) {
  process.stdout.write(`  Waiting for ${label}...`);
  for (let i = 0; i < 300; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const res = await axios.get(`${API_BASE}/translate/progress/${jobId}`, { headers: headers(token) });
      const job = res.data;
      const pct = job.total > 0 ? Math.round(job.progress / job.total * 100) : 0;
      process.stdout.write(`\r  ${label}: ${job.status} ${pct}% (${job.progress}/${job.total})          `);
      if (job.status === 'done' || job.status === 'error' || job.status === 'stopped') {
        console.log(`\n  Final: ${job.status}`);
        return job;
      }
    } catch {}
  }
  console.log('\n  Timed out waiting for job');
  return null;
}

async function triggerJob(pageId, lang, site, force, token) {
  const body = { page_id: pageId, language: lang, force: force === true, env: site };
  const res = await axios.post(`${API_BASE}/translate/page/async`, body, { headers: headers(token) });
  return res.data.job_id;
}

async function getEnabledLangs(token) {
  try {
    const res = await axios.get(`${API_BASE}/languages`, { headers: headers(token) });
    return (res.data || []).filter(l => l.enabled).map(l => l.code);
  } catch {
    return ['ru', 'zh', 'ar', 'de', 'es', 'fa'];
  }
}

async function getHomePage(site, token) {
  try {
    const res = await axios.get(`${API_BASE}/pages/front-page?env=${site}`, { headers: headers(token) });
    return res.data?.post_id || null;
  } catch {
    // Fallback: search for "Home Main"
    try {
      const res = await axios.get(`${API_BASE}/pages?search=home+main&per_page=5&env=${site}`, { headers: headers(token) });
      const page = (res.data?.data || []).find(p => p.post_type === 'page');
      return page?.post_id || null;
    } catch { return null; }
  }
}

(async () => {
  console.log('Bootstrap translations starting...');
  const token = await getToken();
  const langs  = langArg === 'all' ? await getEnabledLangs(token) : [langArg];
  console.log(`Languages: ${langs.join(', ')}`);

  for (const site of SITES) {
    console.log(`\n══ Site: ${site.toUpperCase()} ══`);

    // ── 1. Force-translate home page ────────────────────────────────────────
    if (!navOnly) {
      const homeId = await getHomePage(site, token);
      if (!homeId) {
        console.warn(`  Could not find home page for ${site}, skipping`);
      } else {
        console.log(`  Home page ID: ${homeId}`);
        for (const lang of langs) {
          console.log(`\n  Translating home page → ${lang} (force)`);
          try {
            const jobId = await triggerJob(homeId, lang, site, true, token);
            await waitForJob(jobId, `home/${lang}`, token);
          } catch (e) {
            console.error(`  Error: ${e.message}`);
          }
        }
      }
    }

    // ── 2. Translate global nav menus (post_id = 0) ─────────────────────────
    console.log(`\n  Translating Global (Nav Menus)`);
    for (const lang of langs) {
      console.log(`\n  Global nav → ${lang}`);
      try {
        const jobId = await triggerJob(0, lang, site, false, token);
        await waitForJob(jobId, `global-nav/${lang}`, token);
      } catch (e) {
        console.error(`  Error: ${e.message}`);
      }
    }
  }

  console.log('\n\nAll done.');
})();
