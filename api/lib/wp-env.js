const fs      = require('fs');
const dataDir = require('./data-dir');

const CONFIG_PATH = dataDir('env-config.json');

function getActiveConfig() {
  try {
    const cfg    = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const active = cfg.active || 'staging';
    const site   = (cfg.sites || {})[active];
    if (site && site.url && site.api_key) return site;
  } catch {}
  // fallback to .env
  return { url: process.env.WP_URL, api_key: process.env.WP_API_KEY };
}

function getConfigForSite(siteKey) {
  try {
    const cfg  = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const site = (cfg.sites || {})[siteKey];
    if (site && site.url && site.api_key) return site;
  } catch {}
  return getActiveConfig();
}

const WP        = (siteKey) => (siteKey ? getConfigForSite(siteKey) : getActiveConfig()).url + '/wp-json/btranslate/v1';
const HEADERS   = (siteKey) => ({ 'X-Binayah-API-Key': (siteKey ? getConfigForSite(siteKey) : getActiveConfig()).api_key });
const SITE_KEYS = () => { try { return Object.keys(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).sites || {}); } catch { return []; } };

module.exports = { WP, HEADERS, getActiveConfig, getConfigForSite, SITE_KEYS };
