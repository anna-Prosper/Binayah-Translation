'use strict';
const jwt     = require('jsonwebtoken');
const jwtSecret = require('../lib/jwt-secret');
const fs      = require('fs');
const dataDir = require('../lib/data-dir');
const { read, write, byId, hash, safe, isSuperAdmin } = require('../lib/users');

function guard(req, reply) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) { reply.status(401).send({error:'Unauthorized'}); return null; }
  try {
    const p = jwt.verify(auth.slice(7), jwtSecret());
    if (!isSuperAdmin(p)) { reply.status(403).send({error:'Superadmin only'}); return null; }
    return p;
  } catch { reply.status(401).send({error:'Invalid token'}); return null; }
}

const LOG = dataDir('translation-log.json');
function readLog() { try { return JSON.parse(fs.readFileSync(LOG,'utf8')); } catch { return []; } }

module.exports = async function(fastify) {

  fastify.get('/users', async (req, reply) => {
    if (!guard(req, reply)) return;
    return read().map(safe);
  });

  fastify.post('/users', async (req, reply) => {
    if (!guard(req, reply)) return;
    const { username, password, role, permissions } = req.body || {};
    if (!username || !password) return reply.status(400).send({error:'username and password required'});
    const users = read();
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase()))
      return reply.status(409).send({error:'Username already exists'});
    const newUser = {
      id: 'user_'+Date.now(),
      username, password_hash: await hash(password),
      role: role||'user',
      created_at: new Date().toISOString(),
      last_login: null,
      permissions: {
        hide_modules:      permissions?.hide_modules      || [],
        languages:         permissions?.languages         || [],
        post_types:        permissions?.post_types        || [],
        api:               permissions?.api               || 'all',
        models:            permissions?.models            || [],
        deepseek_models:   permissions?.deepseek_models   || [],
        openrouter_models: permissions?.openrouter_models || [],
        sites:             permissions?.sites             || {},
      }
    };
    users.push(newUser);
    write(users);
    return safe(newUser);
  });

  fastify.put('/users/:id', async (req, reply) => {
    if (!guard(req, reply)) return;
    const users = read();
    const idx = users.findIndex(u => u.id === req.params.id);
    if (idx === -1) return reply.status(404).send({error:'Not found'});
    const { password, permissions, username } = req.body || {};
    if (username) users[idx].username = username;
    if (password && password.trim()) users[idx].password_hash = await hash(password);
    if (permissions) {
      users[idx].permissions = {
        hide_modules:      permissions.hide_modules      ?? users[idx].permissions.hide_modules      ?? [],
        languages:         permissions.languages         ?? users[idx].permissions.languages         ?? [],
        post_types:        permissions.post_types        ?? users[idx].permissions.post_types        ?? [],
        api:               permissions.api               ?? users[idx].permissions.api               ?? 'all',
        models:            permissions.models            ?? users[idx].permissions.models            ?? [],
        deepseek_models:   permissions.deepseek_models   ?? users[idx].permissions.deepseek_models   ?? [],
        openrouter_models: permissions.openrouter_models ?? users[idx].permissions.openrouter_models ?? [],
        sites:             permissions.sites             ?? users[idx].permissions.sites             ?? {},
      };
    }
    write(users);
    return safe(users[idx]);
  });

  fastify.delete('/users/:id', async (req, reply) => {
    const sa = guard(req, reply);
    if (!sa) return;
    if (req.params.id === 'superadmin') return reply.status(400).send({error:'Cannot delete superadmin'});
    if (req.params.id === sa.userId)   return reply.status(400).send({error:'Cannot delete own account'});
    const users = read();
    const filtered = users.filter(u => u.id !== req.params.id);
    if (filtered.length === users.length) return reply.status(404).send({error:'Not found'});
    write(filtered);
    return { success: true };
  });

  // User activity for super admin reports tab
  fastify.get('/users/:id/activity', async (req, reply) => {
    if (!guard(req, reply)) return;
    const user = byId(req.params.id);
    if (!user) return reply.status(404).send({error:'Not found'});
    const logs = readLog().filter(e => (e.user_id||'system') === req.params.id);
    const now = new Date(); const ms = new Date(now.getFullYear(),now.getMonth(),1).toISOString();
    const langs = {}; logs.forEach(e => { if(e.language) langs[e.language]=(langs[e.language]||0)+1; });
    return {
      user: safe(user),
      total_translations: logs.length,
      total_pages: new Set(logs.map(e=>e.post_id)).size,
      this_month: logs.filter(e=>(e.timestamp||'')>=ms).length,
      languages_used: Object.entries(langs).sort((a,b)=>b[1]-a[1]).map(([code,count])=>({code,count})),
      recent: logs.slice(0,20)
    };
  });
};
