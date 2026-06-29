'use strict';
const fs      = require('fs');
const jwt     = require('jsonwebtoken');
const dataDir = require('../lib/data-dir');

const CONFIG_PATH = dataDir('env-config.json');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return { active: 'staging', sites: {} }; }
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function guard(req, reply) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) { reply.status(401).send({ error: 'Unauthorized' }); return null; }
  try {
    const p = jwt.verify(auth.slice(7), process.env.ADMIN_SECRET);
    if (p.role !== 'superadmin') { reply.status(403).send({ error: 'Superadmin only' }); return null; }
    return p;
  } catch { reply.status(401).send({ error: 'Invalid token' }); return null; }
}

module.exports = async function(fastify) {

  fastify.get('/env', async (req, reply) => {
    if (!guard(req, reply)) return;
    const cfg = readConfig();
    const active = cfg.active || 'staging';
    const sites  = cfg.sites  || {};
    return {
      active,
      sites: Object.fromEntries(
        Object.entries(sites).map(([k, v]) => [k, { name: v.name, url: v.url, connected: !!v.api_key }])
      ),
    };
  });

  fastify.post('/env/switch', async (req, reply) => {
    if (!guard(req, reply)) return;
    const { env } = req.body || {};
    if (!env) return reply.code(400).send({ error: 'env required' });
    const cfg = readConfig();
    if (!cfg.sites || !cfg.sites[env]) return reply.code(400).send({ error: 'Unknown environment: ' + env });
    cfg.active = env;
    writeConfig(cfg);
    return { success: true, active: env };
  });

  fastify.post('/sites/register', async (req, reply) => {
    const { site_url, site_name, wp_api_key, admin_secret } = req.body || {};
    if (!admin_secret || admin_secret !== process.env.ADMIN_SECRET) {
      return reply.code(401).send({ error: 'Invalid admin secret' });
    }
    if (!site_url || !wp_api_key) {
      return reply.code(400).send({ error: 'site_url and wp_api_key required' });
    }
    const cfg = readConfig();
    if (!cfg.sites) cfg.sites = {};

    let envKey = 'live';
    if (site_url.includes('staging') || site_url.includes('temp') || site_url.includes('test')) {
      envKey = 'staging';
    }

    cfg.sites[envKey] = {
      name:    site_name || envKey,
      url:     site_url.replace(/\/+$/, ''),
      api_key: wp_api_key,
    };

    if (!cfg.active) cfg.active = envKey;
    writeConfig(cfg);
    return { success: true, site_id: envKey, message: 'Site registered as ' + envKey };
  });

};
