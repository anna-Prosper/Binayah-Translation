require('dotenv').config();
const { initSuperAdmin } = require('./lib/users');
const fastify = require('fastify')({ logger: true });
fastify.register(require('@fastify/cors'), { origin: true });
fastify.get('/', async () => ({ service: 'Binayah Translation API', version: '1.0.0' }));
fastify.register(require('./routes/health'));
fastify.register(require('./routes/pages'));
fastify.register(require('./routes/translate'));
fastify.register(require('./routes/jobs'));
fastify.register(require('./routes/settings'));
fastify.register(require('./routes/auth'));
fastify.register(require('./routes/users'));
fastify.register(require('./routes/languages'));
fastify.register(require('./routes/models'));
fastify.register(require('./routes/translation-log'));
initSuperAdmin().catch(e => console.error('[Users]', e.message));
fastify.listen({ port: process.env.PORT || 4000, host: '0.0.0.0' }, (err) => {
  if (err) { fastify.log.error(err); process.exit(1); }
  console.log('API running on port ' + (process.env.PORT || 4000));
});
