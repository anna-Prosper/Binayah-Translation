'use strict';
/**
 * Deploys the WordPress plugin to both WP sites via the btranslate/v1/self-update endpoint.
 * Requires the self-update endpoint to already be active on the target site.
 *
 * Usage:
 *   node api/scripts/deploy-plugin.js              # deploy to all sites
 *   node api/scripts/deploy-plugin.js --site=temp  # deploy to one site
 *   node api/scripts/deploy-plugin.js --bootstrap  # use WP admin creds for first-time install
 */
const fs      = require('fs');
const path    = require('path');
const axios   = require('axios');
const AdmZip  = require('adm-zip');

// Site keys come from env vars — NEVER hardcode secrets in source.
//   WP_KEY_TEMP=... WP_KEY_STAGING=... node api/scripts/deploy-plugin.js
const SITES = [
  {
    name: 'temp',
    base: 'https://binayah-temp.fixed-staging.co.uk/wp-json/btranslate/v1',
    key:  process.env.WP_KEY_TEMP,
    wpBase: 'https://binayah-temp.fixed-staging.co.uk',
  },
  {
    name: 'staging',
    base: 'https://binayahcom.fixed-staging.co.uk/wp-json/btranslate/v1',
    key:  process.env.WP_KEY_STAGING,
    wpBase: 'https://binayahcom.fixed-staging.co.uk',
  },
].filter(s => {
  if (!s.key) { console.warn(`[deploy] skipping ${s.name}: set WP_KEY_${s.name.toUpperCase()} env var`); return false; }
  return true;
});

const PLUGIN_DIR = path.resolve(__dirname, '../../wordpress-plugin');

// Files to deploy (relative to wordpress-plugin/)
const PLUGIN_FILES = [
  'binayah-translate.php',
  'includes/class-api.php',
  'includes/class-database.php',
  'includes/class-extractor.php',
  'includes/class-frontend.php',
  'includes/class-languages.php',
  'includes/class-settings.php',
];

function buildFileMap() {
  const files = {};
  for (const rel of PLUGIN_FILES) {
    const abs = path.join(PLUGIN_DIR, rel);
    if (!fs.existsSync(abs)) { console.warn('  Missing:', rel); continue; }
    files[rel] = fs.readFileSync(abs).toString('base64');
  }
  return files;
}

async function deployToSite(site, files) {
  console.log(`\n[${site.name.toUpperCase()}] Deploying ${Object.keys(files).length} files via self-update...`);
  try {
    const res = await axios.post(`${site.base}/self-update`,
      { files },
      { headers: { 'X-Binayah-API-Key': site.key, 'Content-Type': 'application/json' }, timeout: 30000 }
    );
    const { written = [], failed = [] } = res.data;
    console.log(`  ✓ Written: ${written.join(', ')}`);
    if (failed.length) console.warn(`  ✗ Failed:  ${failed.join(', ')}`);
    return { written, failed };
  } catch (e) {
    if (e.response?.status === 404) {
      console.error(`  [${site.name}] self-update endpoint not found — run with --bootstrap first`);
    } else {
      console.error(`  [${site.name}] Error: ${e.message}`);
    }
    return null;
  }
}

async function bootstrapViaAdminUpload(site, wpUser, wpAppPassword) {
  console.log(`\n[${site.name.toUpperCase()}] Bootstrap via WP admin plugin upload...`);

  // Build zip in memory
  const zip = new AdmZip();
  for (const rel of PLUGIN_FILES) {
    const abs = path.join(PLUGIN_DIR, rel);
    if (!fs.existsSync(abs)) continue;
    zip.addFile('binayah-translate/' + rel, fs.readFileSync(abs));
  }
  const zipBuffer = zip.toBuffer();

  // Use WP REST API to upload and install the plugin
  const FormData = require('form-data');
  const form = new FormData();
  form.append('pluginzip', zipBuffer, { filename: 'binayah-translate.zip', contentType: 'application/zip' });

  const auth = Buffer.from(`${wpUser}:${wpAppPassword}`).toString('base64');
  try {
    const res = await axios.post(`${site.wpBase}/wp-json/wp/v2/plugins`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Basic ${auth}`,
        },
        timeout: 60000,
        maxBodyLength: 10 * 1024 * 1024,
      }
    );
    console.log(`  ✓ Plugin uploaded: ${res.data.name || 'success'}`);
    return true;
  } catch (e) {
    console.error(`  ✗ Upload failed: ${e.response?.data?.message || e.message}`);
    return false;
  }
}

(async () => {
  const args    = process.argv.slice(2);
  const siteArg = args.find(a => a.startsWith('--site='))?.split('=')[1];
  const doBootstrap = args.includes('--bootstrap');
  const wpUser   = args.find(a => a.startsWith('--wp-user='))?.split('=')[1]    || process.env.WP_ADMIN_USER;
  const wpPass   = args.find(a => a.startsWith('--wp-pass='))?.split('=')[1]    || process.env.WP_ADMIN_PASS;

  // Distinguish "you asked for a site that doesn't exist / has no key" (a real
  // error) from "no sites are configured at all" (nothing to do — e.g. a CI run
  // on a fork or before WP_KEY_* secrets are set). The latter must exit 0 so a
  // plugin-only push doesn't fail the deploy workflow.
  if (siteArg && !SITES.some(s => s.name === siteArg)) {
    console.error(`Site "${siteArg}" not deployable — is WP_KEY_${siteArg.toUpperCase()} set?`);
    process.exit(1);
  }
  const targets = siteArg ? SITES.filter(s => s.name === siteArg) : SITES;
  if (!targets.length) {
    console.warn('[deploy] no sites configured (set WP_KEY_TEMP / WP_KEY_STAGING) — nothing to deploy.');
    return;
  }

  const files = buildFileMap();
  console.log(`Plugin files ready: ${Object.keys(files).length} files`);

  for (const site of targets) {
    if (doBootstrap) {
      if (!wpUser || !wpPass) {
        console.error('--bootstrap requires --wp-user=<user> --wp-pass=<app-password> or WP_ADMIN_USER/WP_ADMIN_PASS env vars');
        process.exit(1);
      }
      const ok = await bootstrapViaAdminUpload(site, wpUser, wpPass);
      if (ok) {
        // After bootstrap, also try self-update to ensure all files are current
        await deployToSite(site, files);
      }
    } else {
      await deployToSite(site, files);
    }
  }

  console.log('\nDone.');
})();
