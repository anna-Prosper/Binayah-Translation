'use strict';
/**
 * One-time bulk wipe of all stale html:N positional keys from both WP sites.
 * Run with: node api/scripts/wipe-html-keys.js
 */
const axios = require('axios');

const SITES = [
  {
    name: 'temp',
    base: 'https://binayah-temp.fixed-staging.co.uk/wp-json/btranslate/v1',
    key:  'dfba88421bd8980b6b28be7a6dfef9af19f9cad5027087206c5b05ddec5eba6c',
  },
  {
    name: 'staging',
    base: 'https://binayahcom.fixed-staging.co.uk/wp-json/btranslate/v1',
    key:  '9d1d8ef7aa255829f16aaff13067f5a8f463837663c8f7fbe35696c49a3a4ff6',
  },
];

const CONCURRENCY = 8;
const BATCH_SIZE  = 100; // keys per WP save call

async function getLanguagesForPage(site, page_id) {
  try {
    const r = await axios.get(`${site.base}/page/${page_id}/languages`, {
      headers: { 'X-Binayah-API-Key': site.key }, timeout: 10000,
    });
    return r.data.languages || [];
  } catch {
    return [];
  }
}

async function wipePageLang(site, page_id, lang) {
  let data;
  try {
    const r = await axios.get(`${site.base}/page/${page_id}/translations?lang=${lang}`, {
      headers: { 'X-Binayah-API-Key': site.key }, timeout: 15000,
    });
    data = r.data || {};
  } catch { return 0; }

  const trans = data.translations || data;
  const htmlKeys = Object.keys(trans).filter(k => k.startsWith('html:') && trans[k]);
  if (!htmlKeys.length) return 0;

  // Wipe in batches
  for (let i = 0; i < htmlKeys.length; i += BATCH_SIZE) {
    const batch = htmlKeys.slice(i, i + BATCH_SIZE);
    const fields = Object.fromEntries(batch.map(k => [k, '']));
    try {
      await axios.post(`${site.base}/page/${page_id}/save`,
        { language_code: lang, fields },
        { headers: { 'X-Binayah-API-Key': site.key, 'Content-Type': 'application/json' }, timeout: 20000 }
      );
    } catch (e) {
      console.warn(`  [${site.name}] page ${page_id} lang ${lang} save failed:`, e.message);
    }
  }
  return htmlKeys.length;
}

async function getAllPages(site) {
  const pages = [];
  let page = 1;
  const per_page = 100;
  while (true) {
    try {
      const r = await axios.get(`${site.base}/pages?per_page=${per_page}&page=${page}`, {
        headers: { 'X-Binayah-API-Key': site.key }, timeout: 30000,
      });
      const batch = r.data.data || r.data.pages || [];
      if (!batch.length) break;
      pages.push(...batch.map(p => ({ id: p.post_id || p.id, langs: p.translated_languages || [] })));
      if (pages.length >= (r.data.total || Infinity)) break;
      page++;
    } catch (e) {
      console.warn(`  [${site.name}] page list fetch failed at page ${page}:`, e.message);
      break;
    }
  }
  return pages;
}

async function runSite(site) {
  console.log(`\n[${site.name.toUpperCase()}] Fetching page list...`);
  const pages = await getAllPages(site);
  console.log(`[${site.name.toUpperCase()}] ${pages.length} pages found`);

  let totalWiped = 0;
  let pagesAffected = 0;
  let done = 0;

  // Build work items: { page_id, lang } for each page+lang combo
  const work = [];
  for (const p of pages) {
    for (const lang of p.langs) {
      work.push({ page_id: p.id, lang });
    }
  }

  console.log(`[${site.name.toUpperCase()}] ${work.length} page-language combos to check`);

  // Process with concurrency limit
  let idx = 0;
  async function worker() {
    while (idx < work.length) {
      const { page_id, lang } = work[idx++];
      const wiped = await wipePageLang(site, page_id, lang);
      if (wiped > 0) {
        totalWiped += wiped;
        pagesAffected++;
        process.stdout.write(`\r[${site.name.toUpperCase()}] ${++done}/${work.length} checked | wiped ${totalWiped} keys on ${pagesAffected} page-langs`);
      } else {
        done++;
        if (done % 100 === 0) {
          process.stdout.write(`\r[${site.name.toUpperCase()}] ${done}/${work.length} checked | wiped ${totalWiped} keys on ${pagesAffected} page-langs`);
        }
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  console.log(`\n[${site.name.toUpperCase()}] Done. Wiped ${totalWiped} html:N keys across ${pagesAffected} page-language combos.`);
  return { totalWiped, pagesAffected };
}

(async () => {
  console.log('Starting bulk html:N wipe across all sites...');
  const results = await Promise.all(SITES.map(runSite));
  const grand = results.reduce((a, r) => ({ wiped: a.wiped + r.totalWiped, affected: a.affected + r.pagesAffected }), { wiped: 0, affected: 0 });
  console.log(`\nAll done. Total: ${grand.wiped} keys wiped across ${grand.affected} page-language combos.`);
})();
