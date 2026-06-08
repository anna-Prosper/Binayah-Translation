'use strict';
const fs   = require('fs');
const path = require('path');
const jwt  = require('jsonwebtoken');
const CFG  = path.join(__dirname, '../language-config.json');

const read  = () => { try { return JSON.parse(fs.readFileSync(CFG,'utf8')); } catch { return []; } };
const save  = (d) => fs.writeFileSync(CFG, JSON.stringify(d, null, 2));
const auth  = (req, reply) => {
  const a = req.headers.authorization || '';
  if (!a.startsWith('Bearer ')) { reply.status(401).send({ error:'Unauthorized' }); return false; }
  try { jwt.verify(a.slice(7), process.env.ADMIN_SECRET); return true; }
  catch { reply.status(401).send({ error:'Invalid token' }); return false; }
};

module.exports = async function(fastify) {
  // Derive country → language code map from config (used by WordPress)
  fastify.get('/languages/country-map', async () => {
    const langs = read().filter(l => l.enabled !== false);
    const map = {};
    for (const lang of langs) {
      if (lang.code === 'en') continue;
      for (const country of (lang.countries || [])) {
        map[country] = lang.code;
      }
    }
    return map;
  });


  // GeoIP lookup — called by WordPress when Cloudflare CF-IPCountry header is absent
  fastify.get('/languages/geoip/:ip', async (req, reply) => {
    const { ip } = req.params;
    if (!ip || !/^[\d.a-f:]+$/i.test(ip)) {
      return reply.status(400).send({ error: 'Invalid IP' });
    }
    return new Promise((resolve) => {
      const http = require('http');
      const url  = 'http://ip-api.com/json/' + encodeURIComponent(ip) + '?fields=countryCode';
      http.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve({ country: json.countryCode || '' });
          } catch { resolve({ country: '' }); }
        });
      }).on('error', () => resolve({ country: '' }));
    });
  });
  fastify.get('/languages/config', async () => read());

  fastify.put('/languages/config/:code', async (req, reply) => {
    if (!auth(req, reply)) return;
    const d = read(), i = d.findIndex(l => l.code === req.params.code);
    if (i === -1) return reply.status(404).send({ error:'Not found' });
    d[i] = { ...d[i], ...req.body }; save(d);
    return { success: true };
  });

  fastify.post('/languages/config', async (req, reply) => {
    if (!auth(req, reply)) return;
    const d = read(), { code, name, native, flag, dir, api, countries } = req.body;
    if (!code || !name) return reply.status(400).send({ error:'code and name required' });
    if (d.find(l => l.code === code)) return reply.status(409).send({ error:'Already exists' });
    d.push({ code: code.toLowerCase().trim(), name, native: native||name, flag: flag||'\u{1F310}', dir: dir||'ltr', enabled: true, api: api||'deepseek', countries: countries||[] });
    save(d); return { success: true };
  });

  fastify.delete('/languages/config/:code', async (req, reply) => {
    if (!auth(req, reply)) return;
    const d = read(), f = d.filter(l => l.code !== req.params.code);
    if (f.length === d.length) return reply.status(404).send({ error:'Not found' });
    save(f); return { success: true };
  });
};
