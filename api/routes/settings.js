const fs      = require('fs');
const path    = require('path');
const axios   = require('axios');
const jwt     = require('jsonwebtoken');
const jwtSecret = require('../lib/jwt-secret');
const dataDir = require('../lib/data-dir');
const { atomicWrite } = require('../lib/atomic-json');

module.exports = async function (fastify) {
  const envPath       = path.join(__dirname, '../.env');
  const globalCfgPath = dataDir('global-config.json');

  // Settings expose/modify API keys and global model config — admin-only.
  fastify.addHook('preHandler', async (req, reply) => {
    const a = req.headers.authorization || '';
    if (!a.startsWith('Bearer ')) return reply.code(401).send({ error: 'Unauthorized' });
    try { jwt.verify(a.slice(7), jwtSecret()); }
    catch { return reply.code(401).send({ error: 'Invalid token' }); }
  });

  function getEnvVal(key) {
    const env = fs.readFileSync(envPath, 'utf8');
    const m = env.match(new RegExp('^' + key + '=(.*)$', 'm'));
    return m ? m[1].trim() : '';
  }

  function maskKey(key) {
    if (!key || key.length < 8) return '';
    return key.slice(0, 8) + '...' + key.slice(-4);
  }

  const readGlobal = () => {
    try { return JSON.parse(fs.readFileSync(globalCfgPath, 'utf8')); }
    catch { return { api: 'deepseek', model: 'deepseek-chat' }; }
  };

  fastify.get('/settings', async () => {
    const dsKey = getEnvVal('DEEPSEEK_API_KEY');
    const orKey = getEnvVal('OPENROUTER_API_KEY');
    const wpUrl = getEnvVal('WP_URL');
    const dsSet = !!(dsKey && dsKey !== 'your_deepseek_key_here');
    const orSet = !!(orKey && orKey !== 'your_openrouter_key_here');
    return {
      wp_url:           wpUrl,
      deepseek_set:     dsSet,
      openrouter_set:   orSet,
      deepseek_masked:  dsSet ? maskKey(dsKey) : '',
      openrouter_masked: orSet ? maskKey(orKey) : '',
    };
  });

  fastify.post('/settings', async (req) => {
    const { deepseek_key, openrouter_key } = req.body;
    let env = fs.readFileSync(envPath, 'utf8');

    if (deepseek_key !== undefined) {
      const val = deepseek_key.trim();
      if (env.match(/^DEEPSEEK_API_KEY=.*$/m)) {
        env = env.replace(/^DEEPSEEK_API_KEY=.*$/m, 'DEEPSEEK_API_KEY=' + val);
      } else {
        env += '\nDEEPSEEK_API_KEY=' + val;
      }
      if (env.match(/^OPENAI_API_KEY=.*$/m)) {
        env = env.replace(/^OPENAI_API_KEY=.*$/m, 'OPENAI_API_KEY=' + val);
      } else {
        env += '\nOPENAI_API_KEY=' + val;
      }
    }

    if (openrouter_key !== undefined) {
      const val = openrouter_key.trim();
      if (env.match(/^OPENROUTER_API_KEY=.*$/m)) {
        env = env.replace(/^OPENROUTER_API_KEY=.*$/m, 'OPENROUTER_API_KEY=' + val);
      } else {
        env += '\nOPENROUTER_API_KEY=' + val;
      }
    }

    atomicWrite(envPath, env);
    require('dotenv').config({ override: true });
    return { success: true };
  });

  fastify.get('/settings/global', async () => { const g = readGlobal(); return {...g, prompt: g.prompt || ''}; });

  fastify.post('/settings/global', async (req) => {
    const { api, model, prompt } = req.body;
    const cfg = readGlobal();
    if (api !== undefined)    cfg.api    = api;
    if (model !== undefined)  cfg.model  = model;
    if (prompt !== undefined) cfg.prompt = prompt;
    atomicWrite(globalCfgPath, JSON.stringify(cfg, null, 2));
    return { success: true };
  });

  fastify.post('/settings/test-deepseek', async (req) => {
    try {
      const key = req.body.key;
      const res = await axios.get('https://api.deepseek.com/v1/models', {
        headers: { Authorization: 'Bearer ' + key }, timeout: 8000,
      });
      return { ok: true, models: res.data.data?.length || 0 };
    } catch (e) {
      return { ok: false, error: e.response?.data?.error?.message || e.message };
    }
  });

  fastify.post('/settings/test-openrouter', async (req) => {
    try {
      const key = req.body.key;
      const res = await axios.get('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: 'Bearer ' + key }, timeout: 8000,
      });
      return { ok: true, models: res.data.data?.length || 0 };
    } catch (e) {
      return { ok: false, error: e.response?.data?.error?.message || e.message };
    }
  });
};
