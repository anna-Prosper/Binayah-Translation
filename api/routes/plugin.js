'use strict';
/**
 * POST /plugin/deploy — reads local plugin PHP files and pushes them
 *                       to one or all WP sites via btranslate/v1/self-update.
 * Requires superadmin JWT.
 */
const fs      = require('fs');
const path    = require('path');
const axios   = require('axios');
const jwt     = require('jsonwebtoken');
const { WP, HEADERS, SITE_KEYS, getConfigForSite } = require('../lib/wp-env');

const PLUGIN_DIR = path.resolve(__dirname, '../../wordpress-plugin');

const PLUGIN_FILES = [
  'binayah-translate.php',
  'includes/class-api.php',
  'includes/class-database.php',
  'includes/class-extractor.php',
  'includes/class-frontend.php',
  'includes/class-languages.php',
  'includes/class-settings.php',
];

function isSuperAdmin(req) {
  try {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return false;
    const p = jwt.verify(h.slice(7), process.env.ADMIN_SECRET);
    return p.role === 'superadmin';
  } catch { return false; }
}

function buildFileMap() {
  const files = {};
  for (const rel of PLUGIN_FILES) {
    const abs = path.join(PLUGIN_DIR, rel);
    if (!fs.existsSync(abs)) continue;
    files[rel] = fs.readFileSync(abs).toString('base64');
  }
  return files;
}

module.exports = async function (fastify) {

  fastify.post('/plugin/deploy', async (req, reply) => {
    if (!isSuperAdmin(req)) return reply.status(403).send({ error: 'Superadmin only' });

    const siteArg = req.body?.site; // optional: 'staging', 'temp', or omit for all
    const siteKeys = siteArg ? [siteArg] : SITE_KEYS();

    if (!siteKeys.length) return reply.status(400).send({ error: 'No sites configured' });

    const files = buildFileMap();
    if (!Object.keys(files).length) return reply.status(500).send({ error: 'No plugin files found' });

    const results = {};
    for (const siteKey of siteKeys) {
      const cfg = getConfigForSite(siteKey);
      const selfUpdateUrl = cfg.url + '/wp-json/btranslate/v1/self-update';
      try {
        const res = await axios.post(selfUpdateUrl,
          { files },
          { headers: { 'X-Binayah-API-Key': cfg.api_key, 'Content-Type': 'application/json' }, timeout: 30000 }
        );
        results[siteKey] = res.data;
      } catch (e) {
        results[siteKey] = { error: e.response?.data?.message || e.message };
      }
    }

    return { results, files_sent: Object.keys(files) };
  });

  fastify.get('/plugin/files', async (req, reply) => {
    if (!isSuperAdmin(req)) return reply.status(403).send({ error: 'Superadmin only' });
    return { files: PLUGIN_FILES, plugin_dir: PLUGIN_DIR };
  });
};
