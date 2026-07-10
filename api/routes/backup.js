'use strict';
/**
 * Backup management endpoints. Superadmin-only.
 *
 *   GET  /backup/list           list snapshots (name, size, mtime)
 *   POST /backup/now            create a snapshot now → returns its metadata
 *   GET  /backup/export         create a fresh snapshot and stream it (offsite pull)
 *   GET  /backup/download/:name stream an existing snapshot
 */
const fs  = require('fs');
const jwt = require('jsonwebtoken');
const jwtSecret = require('../lib/jwt-secret');
const backup = require('../lib/backup');

module.exports = async function (fastify) {
  // Superadmin JWT required for every route in this plugin.
  fastify.addHook('preHandler', async (req, reply) => {
    const a = req.headers.authorization || '';
    if (!a.startsWith('Bearer ')) return reply.code(401).send({ error: 'Unauthorized' });
    try {
      const p = jwt.verify(a.slice(7), jwtSecret());
      if (p.role !== 'superadmin') return reply.code(403).send({ error: 'Superadmin only' });
    } catch { return reply.code(401).send({ error: 'Invalid token' }); }
  });

  fastify.get('/backup/list', async () => ({ snapshots: backup.listSnapshots() }));

  fastify.post('/backup/now', async (req, reply) => {
    const r = backup.createSnapshot();
    if (!r) return reply.code(500).send({ error: 'Nothing to back up' });
    return { ok: true, ...r };
  });

  fastify.get('/backup/export', async (req, reply) => {
    const r = backup.createSnapshot();
    if (!r) return reply.code(500).send({ error: 'Nothing to back up' });
    const p = backup.snapshotPath(r.name);
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${r.name}"`);
    return reply.send(fs.createReadStream(p));
  });

  fastify.get('/backup/download/:name', async (req, reply) => {
    const p = backup.snapshotPath(req.params.name);
    if (!p) return reply.code(404).send({ error: 'Not found' });
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${req.params.name}"`);
    return reply.send(fs.createReadStream(p));
  });
};
