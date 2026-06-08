const fp = require("fastify-plugin")
const axios = require("axios")
const fs = require("fs")
const path = require("path")

const USERS_PATH = path.join(__dirname, "../users.json")
const LOG_PATH   = path.join(__dirname, "../translation-log.json")

function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_PATH, "utf8")) }
  catch { return [] }
}

function readLog() {
  try { return JSON.parse(fs.readFileSync(LOG_PATH, "utf8")) }
  catch { return [] }
}

module.exports = fp(async function (fastify) {
  const WP      = () => process.env.WP_URL + "/wp-json/btranslate/v1"
  const HEADERS = () => ({ "X-Binayah-API-Key": process.env.WP_API_KEY })
  const USAGE   = path.join(__dirname, "../usage-stats.json")

  // GET /stats — global stats from WordPress
  fastify.get("/stats", async (req, reply) => {
    try {
      const { data } = await axios.get(WP() + "/stats", { headers: HEADERS(), timeout: 10000 })
      return data
    } catch (e) {
      return reply.status(502).send({ error: "WordPress unreachable", detail: e.message })
    }
  })

  // GET /user-stats?user_id=X — user-specific dashboard stats
  fastify.get("/user-stats", async (req, reply) => {
    const { user_id } = req.query
    if (!user_id) return reply.status(400).send({ error: "user_id required" })

    const users = readUsers()
    const user  = users.find(function(u) { return u.id === user_id })
    if (!user) return reply.status(404).send({ error: "User not found" })

    const perms     = user.permissions || {}
    const postTypes = perms.post_types || []
    const languages = perms.languages  || []
    const langCount = languages.length > 0 ? languages.length : 10

    // Count total pages for user's assigned post_types
    var totalPages = 0
    if (postTypes.length === 0) {
      // All post types — use global total
      try {
        const { data } = await axios.get(WP() + "/stats", { headers: HEADERS(), timeout: 10000 })
        totalPages = data.total_pages || 0
      } catch (e) { totalPages = 0 }
    } else {
      // Sum pages for each assigned post_type
      for (var i = 0; i < postTypes.length; i++) {
        try {
          const { data } = await axios.get(
            WP() + "/pages?post_type=" + postTypes[i] + "&per_page=1&page=1",
            { headers: HEADERS(), timeout: 10000 }
          )
          totalPages += parseInt(data.total || 0)
        } catch (e) {}
      }
    }

    // Count unique page-language combos this user has translated
    const log      = readLog()
    const userDone = log.filter(function(e) { return e.user_id === user_id && e.status === "done" })
    const seen     = {}
    userDone.forEach(function(e) { seen[e.post_id + "_" + e.language] = true })
    const translatedCount = Object.keys(seen).length

    const pendingCount = Math.max(0, totalPages * langCount - translatedCount)

    return {
      total_pages:      totalPages,
      lang_count:       langCount,
      translated_count: translatedCount,
      pending_count:    pendingCount
    }
  })

  // GET /usage
  fastify.get("/usage", async (req, reply) => {
    try {
      return JSON.parse(fs.readFileSync(USAGE, "utf8"))
    } catch (e) {
      return { total: { calls: 0, fields: 0 }, by_api: {}, by_language: {}, recent: [] }
    }
  })
})
