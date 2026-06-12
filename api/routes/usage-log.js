'use strict';
const jwt  = require('jsonwebtoken');
const fs   = require('fs');
const path = require('path');

const TRANS_LOG  = path.join(__dirname, '../translation-log.json');
const USERS_PATH = path.join(__dirname, '../users.json');

function readLog()   { try { return JSON.parse(fs.readFileSync(TRANS_LOG,  'utf8')); } catch { return []; } }
function readUsers() { try { return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8')); } catch { return []; } }

function authPayload(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  try { return jwt.verify(h.slice(7), process.env.ADMIN_SECRET); } catch { return null; }
}

module.exports = async function (fastify) {

  /* ── GET /usage-log ─────────────────────────────────────────────────── */
  fastify.get('/usage-log', async (req, reply) => {
    const p = authPayload(req);
    if (!p) return reply.status(401).send({ error: 'Unauthorized' });
    const userId       = p.userId || '';
    const isSuperAdmin = p.role === 'superadmin';

    let logs = readLog();

    // Role gate — regular users only see their own rows
    if (!isSuperAdmin) {
      logs = logs.filter(e => (e.user_id || '') === userId);
    }

    // Optional query filters
    const { api, language, post_type, user_id: fu, search } = req.query;
    if (api       )                  logs = logs.filter(e => e.api       === api);
    if (language  )                  logs = logs.filter(e => e.language  === language);
    if (post_type )                  logs = logs.filter(e => e.post_type === post_type);
    if (fu && isSuperAdmin)          logs = logs.filter(e => (e.user_id || '') === fu);
    if (search    ) {
      const q = search.toLowerCase();
      logs = logs.filter(e => (e.post_title || '').toLowerCase().includes(q));
    }

    // Summary (computed from filtered set)
    const summary = {
      total_jobs:    logs.length,
      total_fields:  logs.reduce((s, e) => s + (e.fields_count || 0), 0),
      total_tokens:  logs.reduce((s, e) => s + (e.tokens_used  || 0), 0),
      by_api:      {},
      by_model:    {},
      by_language: {},
      by_user:     {},
    };
    for (const e of logs) {
      const a = e.api      || 'unknown'; summary.by_api[a]      = (summary.by_api[a]      || 0) + 1;
      const m = e.model    || 'unknown'; summary.by_model[m]    = (summary.by_model[m]    || 0) + 1;
      const l = e.language || '?';       summary.by_language[l] = (summary.by_language[l] || 0) + 1;
      if (isSuperAdmin) {
        const u = e.user_name || e.user_id || 'system';
        summary.by_user[u] = (summary.by_user[u] || 0) + 1;
      }
    }

    // Get user list for superadmin filter dropdown
    let users = [];
    if (isSuperAdmin) {
      users = readUsers().map(u => ({ id: u.id, username: u.username, role: u.role }));
    }

    // Pagination
    const perPage = Math.min(parseInt(req.query.per_page || '50', 10), 200);
    const page    = Math.max(parseInt(req.query.page    || '1',  10), 1);
    const total   = logs.length;
    const data    = logs.slice((page - 1) * perPage, page * perPage);

    return { data, total, page, per_page: perPage, total_pages: Math.ceil(total / perPage) || 1, summary, users };
  });
  /* -- GET /usage-log/page-stats?post_id=X -------------------------------- */
  fastify.get('/usage-log/page-stats', async (req, reply) => {
    const p = authPayload(req);
    if (!p) return reply.status(401).send({ error: 'Unauthorized' });
    const isSuperAdmin = p.role === 'superadmin';
    const userId       = p.userId || '';

    const post_id = parseInt(req.query.post_id || '0', 10);
    if (!post_id) return reply.status(400).send({ error: 'post_id required' });

    let logs = readLog().filter(e => e.post_id === post_id);
    if (!isSuperAdmin) logs = logs.filter(e => (e.user_id || '') === userId);

    const summary = {
      post_id,
      post_title:    logs[0] ? (logs[0].post_title || '') : '',
      post_type:     logs[0] ? (logs[0].post_type  || '') : '',
      total_jobs:    logs.length,
      total_fields:  logs.reduce((s,e) => s + (e.fields_count || 0), 0),
      total_tokens:  logs.reduce((s,e) => s + (e.tokens_used  || 0), 0),
      by_language:   {},
      by_model:      {},
      by_api:        {},
    };
    for (const e of logs) {
      const l = e.language || '?';  summary.by_language[l] = (summary.by_language[l] || 0) + 1;
      const m = e.model    || '?';  summary.by_model[m]    = (summary.by_model[m]    || 0) + 1;
      const a = e.api      || '?';  summary.by_api[a]      = (summary.by_api[a]      || 0) + 1;
    }
    return { summary, jobs: logs };
  });

};
