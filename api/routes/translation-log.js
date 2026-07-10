'use strict';
const jwt   = require('jsonwebtoken');
const jwtSecret = require('../lib/jwt-secret');
const tlog = require('../lib/tlog');

// Newest-first, matching the previous array order.
function readLog() { return tlog.readAll(); }

module.exports = async function(fastify) {

  // Admin-only translation history/export. Require a valid JWT.
  fastify.addHook('preHandler', async (req, reply) => {
    const a = req.headers.authorization || '';
    if (!a.startsWith('Bearer ')) return reply.code(401).send({ error: 'Unauthorized' });
    try { jwt.verify(a.slice(7), jwtSecret()); }
    catch { return reply.code(401).send({ error: 'Invalid token' }); }
  });

  fastify.get('/translation-log', async (req) => {
    const { page = 1, per_page = 25, search = '', post_type = '', user_id = '' } = req.query;
    let log = readLog();

    if (search) {
      const q = search.toLowerCase();
      log = log.filter(e => (e.post_title || '').toLowerCase().includes(q));
    }
    if (user_id) { log = log.filter(e => (e.user_id || '') === user_id); }
    if (post_type) {
      log = log.filter(e => e.post_type === post_type);
    }

    const total      = log.length;
    const pageNum    = Math.max(1, parseInt(page));
    const perPageNum = Math.min(100, Math.max(1, parseInt(per_page)));
    const start      = (pageNum - 1) * perPageNum;
    const data       = log.slice(start, start + perPageNum);
    const total_pages = Math.max(1, Math.ceil(total / perPageNum));

    return { data, total, total_pages, page: pageNum, per_page: perPageNum };
  });

  fastify.get('/translation-log/download', async (req, reply) => {
    const { search = '', post_type = '', user_id = '' } = req.query;
    let log = readLog();

    if (user_id) { log = log.filter(e => (e.user_id || '') === user_id); }
    if (search) {
      const q = search.toLowerCase();
      log = log.filter(e => (e.post_title || '').toLowerCase().includes(q));
    }
    if (post_type) log = log.filter(e => e.post_type === post_type);

    const headers = ['ID', 'Date', 'Post ID', 'Page Title', 'Post Type', 'Language', 'API', 'Model', 'Tokens Used', 'Fields Translated', 'Status'];
    const rows = log.map(e => [
      e.id || '',
      e.timestamp || '',
      e.post_id || '',
      (e.post_title || '').replace(/"/g, '""'),
      e.post_type || '',
      e.language || '',
      e.api || '',
      e.model || '',
      e.tokens_used || 0,
      e.fields_count || 0,
      e.status || '',
    ]);

    const csv = [headers, ...rows].map(row =>
      row.map(cell => `"${cell}"`).join(',')
    ).join('\n');

    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', 'attachment; filename="translation-log.csv"');
    return csv;
  });
};
