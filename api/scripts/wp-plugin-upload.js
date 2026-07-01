'use strict';
/**
 * Uploads a plugin zip to WordPress via the wp-admin upload-plugin form.
 * Uses cookie-based auth (regular username + password).
 * Usage: node wp-plugin-upload.js <site-url> <username> <password> <zip-path>
 */
const fs       = require('fs');
const path     = require('path');
const axios    = require('axios');
const FormData = require('form-data');
const AdmZip   = require('adm-zip');
const { JSDOM } = require('jsdom');

const [,, SITE_URL, USER, PASS, ZIP_PATH] = process.argv;

async function run() {
  const base = SITE_URL.replace(/\/$/, '');
  const cookieJar = {};

  function cookieHeader() {
    return Object.entries(cookieJar).map(([k,v]) => `${k}=${v}`).join('; ');
  }
  function parseCookies(res) {
    const setCookie = res.headers['set-cookie'] || [];
    for (const c of setCookie) {
      const [kv] = c.split(';');
      const [k, v] = kv.split('=');
      if (k && v) cookieJar[k.trim()] = v.trim();
    }
  }

  // Step 1: seed test cookie
  cookieJar['wordpress_test_cookie'] = 'WP+Cookie+check';

  // Step 2: login
  console.log('  Logging in...');
  const loginForm = new URLSearchParams({
    log: USER, pwd: PASS, 'wp-submit': 'Log In',
    redirect_to: '/wp-admin/', testcookie: '1',
  });
  const loginRes = await axios.post(`${base}/wp-login.php`, loginForm.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader() },
    maxRedirects: 5, validateStatus: s => s < 400,
  });
  parseCookies(loginRes);
  const authCookies = Object.keys(cookieJar).filter(k => k.startsWith('wordpress_logged_in') || k.startsWith('wordpress_sec'));
  if (!authCookies.length) { console.error('  Login failed — check credentials'); process.exit(1); }
  console.log('  Logged in OK');

  // Step 3: get nonce from plugin-install.php
  const installPage = await axios.get(`${base}/wp-admin/plugin-install.php?tab=upload`, {
    headers: { Cookie: cookieHeader() }, maxRedirects: 3, validateStatus: s => s < 400,
  });
  parseCookies(installPage);

  const dom   = new JSDOM(installPage.data);
  const nonce = dom.window.document.querySelector('#_wpnonce')?.value
             || dom.window.document.querySelector('input[name="_wpnonce"]')?.value;
  if (!nonce) { console.error('  Could not get nonce'); process.exit(1); }
  console.log('  Nonce:', nonce);

  // Step 4: read zip
  let zipBuffer;
  if (ZIP_PATH) {
    zipBuffer = fs.readFileSync(ZIP_PATH);
  } else {
    // Build zip from local plugin dir
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
    const zip = new AdmZip();
    for (const rel of FILES) {
      const abs = path.join(PLUGIN_DIR, rel);
      if (fs.existsSync(abs)) zip.addFile('binayah-translate/' + rel, fs.readFileSync(abs));
    }
    zipBuffer = zip.toBuffer();
    console.log(`  Built zip: ${zipBuffer.length} bytes, ${FILES.length} files`);
  }

  // Step 5: upload
  const form = new FormData();
  form.append('_wpnonce', nonce);
  form.append('_wp_http_referer', '/wp-admin/plugin-install.php?tab=upload');
  form.append('pluginzip', zipBuffer, { filename: 'binayah-translate.zip', contentType: 'application/zip' });
  form.append('install-plugin-submit', 'Install Now');

  console.log('  Uploading plugin zip...');
  const uploadRes = await axios.post(`${base}/wp-admin/update.php?action=upload-plugin`,
    form,
    {
      headers: { ...form.getHeaders(), Cookie: cookieHeader() },
      maxRedirects: 5, validateStatus: s => s < 500,
      maxBodyLength: 20 * 1024 * 1024,
    }
  );
  parseCookies(uploadRes);

  const resultDom = new JSDOM(uploadRes.data);
  const msg = resultDom.window.document.querySelector('.wrap h2, .wrap p, #message')?.textContent?.trim() || '';
  if (uploadRes.status >= 400) {
    console.error('  Upload HTTP error:', uploadRes.status);
    process.exit(1);
  }
  console.log('  Upload response:', msg.slice(0, 200) || '(no message — likely success)');

  // Step 6: activate if not already active (look for activate link)
  const activateLink = [...resultDom.window.document.querySelectorAll('a')]
    .find(a => a.href && a.href.includes('action=activate'));
  if (activateLink) {
    const activateUrl = activateLink.href.startsWith('http') ? activateLink.href : base + activateLink.href;
    console.log('  Activating plugin...');
    await axios.get(activateUrl, { headers: { Cookie: cookieHeader() }, maxRedirects: 5, validateStatus: s => s < 400 });
    console.log('  Activated');
  } else {
    console.log('  Plugin already active (no activate link found)');
  }
}

run().then(() => console.log('Done.')).catch(e => { console.error(e.message); process.exit(1); });
