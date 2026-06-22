'use strict';
const axios = require('axios');

let orCache = null;
let orCacheTime = 0;
const OR_TTL = 60 * 60 * 1000;

const DEEPSEEK_MODELS = [
  { id: 'deepseek-v4-flash',  name: 'DeepSeek V4 Flash' },
  { id: 'deepseek-v4-pro',    name: 'DeepSeek V4 Pro' },
  { id: 'deepseek-chat',      name: 'DeepSeek Chat V3 (legacy)' },
  { id: 'deepseek-reasoner',  name: 'DeepSeek Reasoner R1 (legacy)' },
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

  // DeepSeek direct API pricing (per 1M tokens, cache-miss input rates)
  const DEEPSEEK_PRICING = {
    'deepseek-v4-flash':  { inp: 0.14,   out: 0.28  },
    'deepseek-v4-pro':    { inp: 0.435,  out: 0.87  },
    'deepseek-chat':      { inp: 0.14,   out: 0.28  },
    'deepseek-reasoner':  { inp: 0.14,   out: 0.28  },
  };

  fastify.get('/models/pricing', async (req, reply) => {
    const pricing = { ...DEEPSEEK_PRICING };
    // Add OpenRouter model pricing from cached model list
    const key = process.env.OPENROUTER_API_KEY;
    if (key) {
      try {
        const now = Date.now();
        let orModels = orCache;
        if (!orModels || (now - orCacheTime) > OR_TTL) {
          const res = await axios.get('https://openrouter.ai/api/v1/models', {
            headers: { Authorization: 'Bearer ' + key }, timeout: 10000,
          });
          const filtered = (res.data.data || [])
            .filter(m => (m.context_length || 0) >= 4096 && !/(vision|image|embed)/i.test(m.id))
            .map(m => ({ id: m.id, name: m.name || m.id }))
            .sort((a, b) => a.name.localeCompare(b.name));
          orCache = filtered;
          orCacheTime = now;
          orModels = filtered;
          // Also store full pricing data in a separate cache
          for (const m of (res.data.data || [])) {
            if (m.pricing && (parseFloat(m.pricing.prompt) > 0 || parseFloat(m.pricing.completion) > 0)) {
              pricing[m.id] = {
                inp: parseFloat(m.pricing.prompt)     * 1000000,
                out: parseFloat(m.pricing.completion) * 1000000,
              };
            }
          }
        } else {
          // Use already cached full pricing if available via a secondary fetch
          const res2 = await axios.get('https://openrouter.ai/api/v1/models', {
            headers: { Authorization: 'Bearer ' + key }, timeout: 10000,
          });
          for (const m of (res2.data.data || [])) {
            if (m.pricing && (parseFloat(m.pricing.prompt) > 0 || parseFloat(m.pricing.completion) > 0)) {
              pricing[m.id] = {
                inp: parseFloat(m.pricing.prompt)     * 1000000,
                out: parseFloat(m.pricing.completion) * 1000000,
              };
            }
          }
        }
      } catch(e) {
        // Return at least DeepSeek pricing on error
      }
    }
    return reply.send(pricing);
  });

};
