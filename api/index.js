require('dotenv').config();
const { initSuperAdmin } = require('./lib/users');
const backup = require('./lib/backup');
// trustProxy: the API runs behind Render's proxy (and the admin UI's Next.js
// rewrite), so the real client IP is in X-Forwarded-For. Without this, req.ip
// is the proxy's IP and rate-limiting / allowlisting would be meaningless.
const fastify = require('fastify')({ logger: true, trustProxy: true });

// Deployed build marker — Render injects RENDER_GIT_COMMIT. Surfaced on / and
// /health so we can tell at a glance which commit is actually live (a failed
// deploy leaves the previous commit serving).
const COMMIT = process.env.RENDER_GIT_COMMIT || 'dev';

// CORS allowlist. The admin UI reaches the API through its own Next.js /api
// rewrite (server-side proxy), so browsers never call this API cross-origin —
// meaning we can safely restrict CORS. Non-browser callers (WordPress via PHP,
// curl, scripts) send no Origin header and are always allowed. Override/extend
// with a comma-separated ALLOWED_ORIGINS env var.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  'https://binayah-translation-admin.onrender.com')
  .split(',').map(s => s.trim()).filter(Boolean);
fastify.register(require('@fastify/cors'), {
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(null, false);
  },
});
// Rate limiting — registered before routes so its `global` policy covers them.
// Policy (see lib/rate-limit.js): first-party traffic (public /languages/*,
// /health, valid-JWT admin calls, allowlisted IPs) is exempt; anonymous callers
// are capped; /auth/login has its own strict global cap set on the route.
fastify.register(require('@fastify/rate-limit'), require('./lib/rate-limit').globalOptions);

fastify.get('/', async () => ({ service: 'Binayah Translation API', version: '1.0.0', commit: COMMIT }));
fastify.register(require('./routes/health'));
fastify.register(require('./routes/backup'));
fastify.register(require('./routes/pages'));
fastify.register(require('./routes/translate'));
fastify.register(require('./routes/settings'));
fastify.register(require('./routes/auth'));
fastify.register(require('./routes/users'));
fastify.register(require('./routes/languages'));
fastify.register(require('./routes/models'));
fastify.register(require('./routes/translation-log'));
fastify.register(require('./routes/usage-log'));
fastify.register(require('./routes/env'));
fastify.register(require('./routes/plugin'));
initSuperAdmin().catch(e => console.error('[Users]', e.message));
fastify.listen({ port: process.env.PORT || 4000, host: '0.0.0.0' }, (err) => {
  if (err) { fastify.log.error(err); process.exit(1); }
  console.log('API running on port ' + (process.env.PORT || 4000) + ' (commit ' + COMMIT + ')');
  backup.startSchedule(fastify.log);
});

