const axios = require('axios');
const jwt   = require('jsonwebtoken');
const { WP, HEADERS, SITE_KEYS } = require('../lib/wp-env');
const fs    = require('fs');
const path  = require('path');

// Resolve which site env to use for this request.
// siteParam = req.query.env, userPayload = decoded JWT (may be null for public routes)
function resolveSite(siteParam, userPayload) {
  if (!siteParam) return undefined; // use global active
  const available = SITE_KEYS();
  if (!available.includes(siteParam)) return undefined;
  if (!userPayload) return undefined;
  if (userPayload.role === 'superadmin') return siteParam;
  const sites = (userPayload.permissions || {}).sites || {};
  if (sites[siteParam] !== undefined) return siteParam;
  return undefined;
}

function decodeToken(req) {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return null;
    return jwt.verify(auth.slice(7), process.env.ADMIN_SECRET);
  } catch { return null; }
}


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
      const site = resolveSite(req.query.env, decodeToken(req));
      const res = await axios.get(`${WP(site)}/post-types`, { headers: HEADERS(site), timeout: 10000 });
      return res.data;
    } catch (err) {
      return reply.status(502).send({ error: 'Could not fetch post types', detail: err.message });
    }
  });

  fastify.get('/pages', async (req, reply) => {
    try {
      const site = resolveSite(req.query.env, decodeToken(req));
      const res = await axios.get(`${WP(site)}/pages`, {
        headers: HEADERS(site),
        params: {
          post_type: req.query.post_type || 'all',
          page:      req.query.page      || 1,
          per_page:  req.query.per_page  || 50,
          search:    req.query.search    || '',
        },
        timeout: 15000,
      });
      const data = res.data;
      // Inject synthetic "Global (Nav Menus)" entry on page 1 with no search filter
      if (!req.query.search && (!req.query.page || req.query.page === '1')) {
        const globalEntry = {
          id: 0, post_id: 0, post_type: 'global',
          title: '🌐 Global (Nav Menus)',
          slug: 'global-nav-menus',
          url: '',
          modified: '',
          translated_languages: [],
        };
        data.data = [globalEntry, ...(data.data || [])];
        data.total = (data.total || 0) + 1;
      }
      return data;
    } catch (err) {
      return reply.status(502).send({ error: 'Could not fetch pages', detail: err.message });
    }
  });

  fastify.get('/pages/front-page', async (req, reply) => {
    try {
      const site = resolveSite(req.query.env, decodeToken(req));
      const res = await axios.get(`${WP(site)}/front-page`, { headers: HEADERS(site), timeout: 10000 });
      return res.data;
    } catch (err) {
      return reply.status(502).send({ error: 'Could not fetch front page', detail: err.message });
    }
  });

  fastify.get('/page/:id/content', async (req, reply) => {
    try {
      const id = req.params.id;
      const url = id === '0' ? `${WP()}/global/content` : `${WP()}/page/${id}/content`;
      const res = await axios.get(url, { headers: HEADERS(), timeout: 10000 });
      return res.data;
    } catch (err) {
      return reply.status(502).send({ error: 'Could not fetch page content', detail: err.message });
    }
  });

  fastify.get('/page/:id/translations', async (req, reply) => {
    try {
      const id  = req.params.id;
      const url = id === '0'
        ? `${WP()}/global/translations?lang=${req.query.lang || 'ar'}`
        : `${WP()}/page/${id}/translations?lang=${req.query.lang || 'ar'}`;
      const res = await axios.get(url, { headers: HEADERS(), timeout: 10000 });
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

  // GET /user-stats?user_id=X&env=live — user-specific dashboard stats
  fastify.get('/user-stats', async (req, reply) => {
    const { user_id, env: envParam } = req.query;
    if (!user_id) return reply.status(400).send({ error: 'user_id required' });

    const users = readUsers();
    const user  = users.find(function(u) { return u.id === user_id; });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const perms     = user.permissions || {};
    const languages = perms.languages  || [];
    const langCount = languages.length > 0 ? languages.length : 10;

    // Determine which site to query
    const site = resolveSite(envParam, decodeToken(req));

    // Determine post types: prefer sites[env] over flat post_types
    var postTypes = [];
    var allTypesAllowed = false;
    const sitesMap = perms.sites || {};
    const siteKeys = Object.keys(sitesMap);
    if (siteKeys.length > 0) {
      // New site-based permissions
      if (site && sitesMap[site] !== undefined) {
        // Specific site requested
        postTypes = sitesMap[site] || [];
        allTypesAllowed = postTypes.length === 0;
      } else {
        // No specific site — union across all assigned sites
        var seen2 = {};
        for (var sk = 0; sk < siteKeys.length; sk++) {
          var siteTypes = sitesMap[siteKeys[sk]] || [];
          if (siteTypes.length === 0) { allTypesAllowed = true; break; }
          for (var st = 0; st < siteTypes.length; st++) { seen2[siteTypes[st]] = true; }
        }
        postTypes = allTypesAllowed ? [] : Object.keys(seen2);
      }
    } else {
      // Old flat post_types field
      postTypes = perms.post_types || [];
      allTypesAllowed = postTypes.length === 0;
    }

    // Count total pages
    var totalPages = 0;
    if (allTypesAllowed) {
      try {
        const res = await axios.get(`${WP(site)}/stats`, { headers: HEADERS(site), timeout: 10000 });
        totalPages = res.data.total_pages || 0;
      } catch (e) { totalPages = 0; }
    } else {
      for (var i = 0; i < postTypes.length; i++) {
        try {
          const res = await axios.get(`${WP(site)}/pages`, {
            headers: HEADERS(site),
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

  // GET /page-report/:post_id — translation history for a single page
  fastify.get('/page-report/:post_id', async (req, reply) => {
    const postId = parseInt(req.params.post_id);
    if (!postId) return reply.status(400).send({ error: 'post_id required' });

    const log = readLog();
    const entries = log.filter(function(e) { return e.post_id === postId && e.status === 'done'; });

    // Group by language
    const byLang = {};
    entries.forEach(function(e) {
      if (!byLang[e.language]) {
        byLang[e.language] = { language: e.language, language_name: e.language_name || e.language, count: 0, history: [] };
      }
      byLang[e.language].count++;
      byLang[e.language].history.push({
        timestamp:   e.timestamp,
        user_name:   e.user_name || e.user_id || '—',
        api:         e.api      || '—',
        model:       e.model    || '—',
        fields_count: e.fields_count || 0,
        tokens_used:  e.tokens_used  || 0,
      });
    });

    // Sort each language's history newest first
    Object.values(byLang).forEach(function(lang) {
      lang.history.sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
    });

    // Sort languages: most translated first, then alphabetical
    const languages = Object.values(byLang).sort(function(a, b) {
      return b.count - a.count || a.language.localeCompare(b.language);
    });

    const pageTitle = entries.length ? (entries[0].post_title || '') : '';

    return { post_id: postId, page_title: pageTitle, total_translations: entries.length, languages };
  });

  fastify.get('/pages/search-by-url', async (req, reply) => {
    try {
      const site = resolveSite(req.query.env, decodeToken(req));
      const res = await axios.get(`${WP(site)}/pages/search-by-url`, {
        headers: HEADERS(site),
        params: { url: req.query.url || '' },
        timeout: 15000,
      });
      return res.data;
    } catch (err) {
      return reply.status(502).send({ error: 'Could not search by URL', detail: err.message });
    }
  });

};
