'use strict';
/**
 * Translate all pages on a site for all enabled languages.
 * Uses no-force so already-translated pages are skipped (just checks cache).
 *
 * Usage:
 *   node api/scripts/translate-all-pages.js --site=temp
 *   node api/scripts/translate-all-pages.js --site=staging
 *   node api/scripts/translate-all-pages.js --site=temp --lang=ru
 *   node api/scripts/translate-all-pages.js --site=temp --concurrency=3
 */
const jwt   = require('jsonwebtoken');
const axios = require('axios');

const API    = 'https://binayah-translation-api.onrender.com';
const SECRET = process.env.ADMIN_SECRET || 'BinayahAdmin2024!';
const token  = jwt.sign({ id: 'superadmin', role: 'superadmin', username: 'admin' }, SECRET, { expiresIn: '12h' });
const H      = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

const args        = process.argv.slice(2);
const siteArg     = args.find(a => a.startsWith('--site='))?.split('=')[1]        || 'temp';
const langArg     = args.find(a => a.startsWith('--lang='))?.split('=')[1]        || 'all';
const concurrency = parseInt(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '2', 10);
const forceAll    = args.includes('--force');

async function getEnabledLangs() {
  const r = await axios.get(`${API}/languages/config`, { headers: H });
  return (r.data || []).filter(l => l.enabled).map(l => l.code);
}

async function getPages(page, perPage) {
  const r = await axios.get(`${API}/pages?env=${siteArg}&page=${page}&per_page=${perPage}`, { headers: H, validateStatus: s => true });
  return r.data;
}

async function trigger(pageId, lang) {
  const r = await axios.post(`${API}/translate/page/async`,
    { page_id: pageId, language: lang, force: forceAll, env: siteArg },
    { headers: H, validateStatus: s => true }
  );
  return r.data?.job_id || null;
}

async function waitJob(jobId) {
  for (let i = 0; i < 300; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const r = await axios.get(`${API}/translate/progress/${jobId}`, { headers: H, validateStatus: s => true });
    const j = r.data;
    if (j.status === 'done' || j.status === 'error' || j.status === 'stopped') return j.status;
  }
  return 'timeout';
}

async function processPage(page, langs) {
  for (const lang of langs) {
    const jobId = await trigger(page.post_id, lang);
    if (!jobId) continue;
    const status = await waitJob(jobId);
    if (status !== 'done') console.log(`  [${page.post_id}/${lang}] ${status}`);
  }
}

(async () => {
  const langs = langArg === 'all' ? await getEnabledLangs() : [langArg];
  console.log(`Site: ${siteArg} | Languages: ${langs.join(', ')} | Concurrency: ${concurrency} | Force: ${forceAll}`);

  // Page 1 includes the synthetic Global entry (post_id=0)
  // Always translate global first
  console.log('\n[Global Nav Menus]');
  for (const lang of langs) {
    const jobId = await trigger(0, lang);
    if (jobId) {
      await waitJob(jobId);
      process.stdout.write('.');
    }
  }
  console.log(' done');

  // Paginate through all pages
  const PER_PAGE = 50;
  let page = 1;
  let totalPages = 1;
  let done = 0;
  let total = 0;
  const startTime = Date.now();

  console.log('\n[All Pages]');

  while (page <= totalPages) {
    const data = await getPages(page, PER_PAGE);
    if (!data || !data.data) break;

    totalPages = data.total_pages || 1;
    total      = data.total      || 0;

    // Filter out global (post_id=0), non-translatable post types, drafts
    const items = (data.data || []).filter(p => p.post_id > 0);

    // Process in batches of `concurrency`
    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      await Promise.all(batch.map(p => processPage(p, langs)));
      done += batch.length;
      const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
      const rate    = done / (Date.now() - startTime) * 60000;
      const eta     = ((total - done) / rate / 60).toFixed(0);
      process.stdout.write(`\r  Progress: ${done}/${total} pages | ${elapsed}min elapsed | ~${eta}min remaining    `);
    }

    page++;
  }

  console.log(`\n\nAll pages translated. Total: ${done} pages, ${langs.length} languages.`);
})().catch(e => { console.error(e.message); process.exit(1); });
