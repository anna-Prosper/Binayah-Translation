'use strict';
const axios   = require('axios');
const FormData = require('form-data');
const AdmZip  = require('adm-zip');
const fs      = require('fs');
const path    = require('path');

const PASS = process.argv[2] || 'aowm)wZgKh&kdVtXIH)*e(@6';
const SITES = [
  { name: 'temp',    base: 'https://binayah-temp.fixed-staging.co.uk' },
  { name: 'staging', base: 'https://binayahcom.fixed-staging.co.uk' },
];
const PLUGIN_DIR = path.resolve(__dirname, '../../wordpress-plugin');
const FILES = [
  'binayah-translate.php',
  'includes/class-api.php',
  'includes/class-database.php',
  'includes/class-extractor.php',
  'includes/class-frontend.php',
  'includes/class-languages.php',
  'includes/class-settings.php',
];

function buildZip() {
  const zip = new AdmZip();
  for (const rel of FILES) {
    const abs = path.join(PLUGIN_DIR, rel);
    if (fs.existsSync(abs)) zip.addFile('binayah-translate/' + rel, fs.readFileSync(abs));
    else console.warn('  MISSING:', rel);
  }
  const buf = zip.toBuffer();
  console.log('  Zip built:', buf.length, 'bytes,', FILES.length, 'files');
  return buf;
}

async function deploy(site, zipBuffer) {
  console.log('\n[' + site.name.toUpperCase() + '] Starting...');
  const jar = { wordpress_test_cookie: 'WP+Cookie+check' };

  function ch() { return Object.entries(jar).map(([k,v]) => k + '=' + v).join('; '); }
  function pc(res) {
    for (const c of res.headers['set-cookie'] || []) {
      const [kv] = c.split(';');
      const eq   = kv.indexOf('=');
      if (eq > 0) jar[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
    }
  }

  // Login
  const lf = new URLSearchParams({ log: 'admin', pwd: PASS, 'wp-submit': 'Log In', redirect_to: '/wp-admin/', testcookie: '1' });
  const lr = await axios.post(site.base + '/wp-login.php', lf.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: ch() },
    maxRedirects: 5, validateStatus: s => true,
  });
  pc(lr);
  const authed = Object.keys(jar).some(k => k.startsWith('wordpress_logged_in'));
  if (!authed) { console.log('  Login FAILED — wrong password?'); return; }
  console.log('  Logged in OK');

  // Get nonce
  const ip = await axios.get(site.base + '/wp-admin/plugin-install.php?tab=upload', {
    headers: { Cookie: ch() }, validateStatus: s => true,
  });
  pc(ip);
  const nm = ip.data.match(/name="_wpnonce" value="([^"]+)"/);
  if (!nm) { console.log('  No nonce found on plugin-install page'); return; }
  const nonce = nm[1];
  console.log('  Nonce:', nonce);

  // Upload
  const form = new FormData();
  form.append('_wpnonce', nonce);
  form.append('_wp_http_referer', '/wp-admin/plugin-install.php?tab=upload');
  form.append('pluginzip', zipBuffer, { filename: 'binayah-translate.zip', contentType: 'application/zip' });
  form.append('install-plugin-submit', 'Install Now');

  const ur = await axios.post(site.base + '/wp-admin/update.php?action=upload-plugin', form, {
    headers: { ...form.getHeaders(), Cookie: ch() },
    maxRedirects: 5, validateStatus: s => true, maxBodyLength: 20 * 1024 * 1024,
  });
  pc(ur);
  console.log('  Upload HTTP status:', ur.status);

  const h2 = (ur.data.match(/<h2[^>]*>([^<]+)<\/h2>/g) || []).map(m => m.replace(/<[^>]+>/g, '')).join(' | ');
  const ok = ur.data.includes('successfully') || ur.data.includes('Plugin updated') || ur.data.includes('replace-current');
  console.log('  Result:', h2 || (ok ? 'Success' : 'Unknown response'));

  // Click Replace or Activate if present
  const replaceM = ur.data.match(/href="([^"]*replace-current[^"]*)"/);
  const activateM = ur.data.match(/href="([^"]*action=activate[^"]*)"/);
  const actionLink = replaceM?.[1] || activateM?.[1];
  if (actionLink) {
    const url = actionLink.startsWith('http') ? actionLink : site.base + actionLink.replace(/&amp;/g, '&');
    console.log('  Following link:', url.slice(0, 80));
    const ar = await axios.get(url, { headers: { Cookie: ch() }, maxRedirects: 5, validateStatus: s => true });
    console.log('  Link result:', ar.status);
  }

  // Verify via btranslate health check
  await new Promise(r => setTimeout(r, 2000));
  const hr = await axios.get(site.base + '/wp-json/btranslate/v1/health', { validateStatus: s => true });
  console.log('  Plugin health:', hr.status, JSON.stringify(hr.data).slice(0, 100));

  // Verify self-update endpoint exists
  const sr = await axios.post(site.base + '/wp-json/btranslate/v1/self-update', { files: {} }, {
    headers: { 'X-Binayah-API-Key': 'test' }, validateStatus: s => true,
  });
  console.log('  Self-update endpoint:', sr.status === 404 ? 'NOT FOUND (old plugin)' : 'EXISTS (' + sr.status + ')');
}

(async () => {
  const zip = buildZip();
  for (const site of SITES) await deploy(site, zip);
  console.log('\nAll done.');
})();
