const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const WP      = () => process.env.WP_URL + '/wp-json/btranslate/v1';
const HEADERS = () => ({ 'X-Binayah-API-Key': process.env.WP_API_KEY });

const USERS_PATH = path.join(__dirname, '../users.json');
const LOG_PATH   = path.join(__dirname, '../translation-log.json');

function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8')); }
  catch { return []; }
}

function readLog() {
  try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); }
  catch { return []; }
}

module.exports = async function (fastify) {

  fastify.get('/post-types', async (req, reply) => {
    try {
      const res = await axios.get(`${WP()}/post-types`, { headers: HEADERS(), timeout: 10000 });
      return res.data;
    } catch (err) {
      return reply.status(502).send({ error: 'Could not fetch post types', detail: err.message });
    }
  });

  fastify.get('/pages', async (req, reply) => {
    try {
      const res = await axios.get(`${WP()}/pages`, {
        headers: HEADERS(),
        params: {
          post_type: req.query.post_type || 'all',
          page:      req.query.page      || 1,
          per_page:  req.query.per_page  || 50,
          search:    req.query.search    || '',
        },
        timeout: 15000,
      });
      return res.data;
    } catch (err) {
      return reply.status(502).send({ error: 'Could not fetch pages', detail: err.message });
    }
  });

  fastify.get('/pages/front-page', async (req, reply) => {
    try {
      const res = await axios.get(`${WP()}/front-page`, { headers: HEADERS(), timeout: 10000 });
      return res.data;
    } catch (err) {
      return reply.status(502).send({ error: 'Could not fetch front page', detail: err.message });
    }
  });

  fastify.get('/page/:id/content', async (req, reply) => {
    try {
      const res = await axios.get(`${WP()}/page/${req.params.id}/content`, {
        headers: HEADERS(), timeout: 10000,
      });
      return res.data;
    } catch (err) {
      return reply.status(502).send({ error: 'Could not fetch page content', detail: err.message });
    }
  });

  fastify.get('/page/:id/translations', async (req, reply) => {
    try {
      const res = await axios.get(
        `${WP()}/page/${req.params.id}/translations?lang=${req.query.lang || 'ar'}`,
        { headers: HEADERS(), timeout: 10000 }
      );
      return res.data;
    } catch {
      return {};
    }
  });

  fastify.get('/stats', async (req, reply) => {
    try {
      const res = await axios.get(`${WP()}/stats`, { headers: HEADERS(), timeout: 10000 });
      return res.data;
    } catch (err) {
      return reply.status(502).send({ error: 'Could not fetch stats', detail: err.message });
    }
  });

  // GET /user-stats?user_id=X — user-specific dashboard stats
  fastify.get('/user-stats', async (req, reply) => {
    const { user_id } = req.query;
    if (!user_id) return reply.status(400).send({ error: 'user_id required' });

    const users = readUsers();
    const user  = users.find(function(u) { return u.id === user_id; });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const perms     = user.permissions || {};
    const postTypes = perms.post_types || [];
    const languages = perms.languages  || [];
    const langCount = languages.length > 0 ? languages.length : 10;

    // Count total pages for user's assigned post_types
    var totalPages = 0;
    if (postTypes.length === 0) {
      // All post types — use global total
      try {
        const res = await axios.get(`${WP()}/stats`, { headers: HEADERS(), timeout: 10000 });
        totalPages = res.data.total_pages || 0;
      } catch (e) { totalPages = 0; }
    } else {
      // Sum pages for each assigned post_type
      for (var i = 0; i < postTypes.length; i++) {
        try {
          const res = await axios.get(`${WP()}/pages`, {
            headers: HEADERS(),
            params: { post_type: postTypes[i], per_page: 1, page: 1 },
            timeout: 10000,
          });
          totalPages += parseInt(res.data.total || 0);
        } catch (e) {}
      }
    }

    // Count unique page-language combos this user has translated
    const log      = readLog();
    const userDone = log.filter(function(e) { return e.user_id === user_id && e.status === 'done'; });
    const seen     = {};
    userDone.forEach(function(e) { seen[e.post_id + '_' + e.language] = true; });
    const translatedCount = Object.keys(seen).length;

    const pendingCount = Math.max(0, totalPages * langCount - translatedCount);

    return {
      total_pages:      totalPages,
      lang_count:       langCount,
      translated_count: translatedCount,
      pending_count:    pendingCount,
    };
  });

  fastify.get('/pages/search-by-url', async (req, reply) => {
    try {
      const res = await axios.get(`${WP()}/pages/search-by-url`, {
        headers: HEADERS(),
        params: { url: req.query.url || '' },
        timeout: 15000,
      });
      return res.data;
    } catch (err) {
      return reply.status(502).send({ error: 'Could not search by URL', detail: err.message });
    }
  });

};
