'use strict';
const axios = require('axios');

let orCache = null;
let orCacheTime = 0;
const OR_TTL = 60 * 60 * 1000;

const DEEPSEEK_MODELS = [
  { id: 'deepseek-chat',     name: 'DeepSeek Chat (V3)' },
  { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner (R1)' },
];

module.exports = async function(fastify) {
  fastify.get('/models', async (req, reply) => {
    const api = req.query.api || 'deepseek';
    if (api === 'deepseek') return { models: DEEPSEEK_MODELS };
    if (api === 'openrouter') {
      const now = Date.now();
      if (orCache && (now - orCacheTime) < OR_TTL) return { models: orCache };
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) return { models: [], error: 'OpenRouter API key not configured' };
      try {
        const res = await axios.get('https://openrouter.ai/api/v1/models', {
          headers: { Authorization: 'Bearer ' + key }, timeout: 10000,
        });
        const filtered = (res.data.data || [])
          .filter(m => (m.context_length || 0) >= 4096 && !/(vision|image|embed)/i.test(m.id))
          .map(m => ({ id: m.id, name: m.name || m.id }))
          .sort((a, b) => a.name.localeCompare(b.name));
        orCache = filtered;
        orCacheTime = now;
        return { models: filtered };
      } catch(e) {
        return { models: orCache || [], error: e.message };
      }
    }
    return reply.status(400).send({ error: 'Unknown api type' });
  });
};
