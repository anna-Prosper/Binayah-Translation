'use strict';
const jwt = require('jsonwebtoken');
const { byUsername, verify, read, write, safe, initSuperAdmin } = require('../lib/users');

const sign = (u) => jwt.sign(
  { userId: u.id, username: u.username, role: u.role, permissions: u.permissions },
  process.env.ADMIN_SECRET, { expiresIn: '7d' }
);

module.exports = async function(fastify) {

  fastify.post('/auth/login', async (req, reply) => {
    const { username, password } = req.body || {};
    if (!password) return reply.status(400).send({ error: 'Password required' });

    // Legacy: password only → log in as superadmin
    if (!username) {
      if (password !== process.env.ADMIN_SECRET)
        return reply.status(401).send({ error: 'Invalid password' });
      const users = read();
      const sa = users.find(u => u.role === 'superadmin');
      if (sa) {
        const users2 = read(); const idx = users2.findIndex(u=>u.id===sa.id);
        if (idx>=0) { users2[idx].last_login = new Date().toISOString(); write(users2); }
        const token = sign(sa);
        return { token, ...safe(sa) };
      }
      return reply.status(401).send({ error: 'No superadmin found' });
    }

    // Username + password login
    const user = byUsername(username);
    if (!user) return reply.status(401).send({ error: 'Invalid username or password' });
    const ok = await verify(password, user.password_hash);
    if (!ok) return reply.status(401).send({ error: 'Invalid username or password' });

    // Update last_login
    const users = read(); const idx = users.findIndex(u => u.id === user.id);
    if (idx >= 0) { users[idx].last_login = new Date().toISOString(); write(users); }

    const token = sign(user);
    return { token, ...safe(user) };
  });

  // GET /auth/me — refresh token with latest permissions from DB (no re-login needed)
  fastify.get('/auth/me', async (req, reply) => {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    try {
      const p = jwt.verify(auth.slice(7), process.env.ADMIN_SECRET);
      const users = read();
      const user = users.find(function(u) { return u.id === p.userId; });
      if (!user) return reply.status(404).send({ error: 'User not found' });
      const token = sign(user);
      return { token, ...safe(user) };
    } catch (e) {
      return reply.status(401).send({ error: 'Invalid token' });
    }
  });

  fastify.get('/auth/verify', async (req) => {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return { valid: false };
    try {
      const p = jwt.verify(auth.slice(7), process.env.ADMIN_SECRET);
      return { valid: true, ...p };
    } catch { return { valid: false }; }
  });
};
