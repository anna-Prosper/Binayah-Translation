'use strict';
/**
 * Rate-limit policy. The hard part here is that almost all *legitimate* traffic
 * arrives from a small number of fixed IPs, so a naive per-IP limit would
 * throttle the whole product:
 *   - The WordPress plugin calls the public /languages/* routes server-side,
 *     once per visitor, from the WP server's single IP.
 *   - The admin UI proxies every /api/* call through its Next.js server, so all
 *     admin traffic also shares one IP.
 *
 * Policy: exempt first-party traffic and cap only anonymous internet callers.
 *   Exempt (no limit):
 *     - public plugin/probe paths: /languages/*, /health, /  (never throttle the frontend)
 *     - any request carrying a valid admin JWT (all admin-UI traffic does)
 *     - explicit IPs in RATE_LIMIT_ALLOWLIST (belt-and-suspenders for the WP server)
 *   Limited: everything else (anonymous, non-plugin) at RATE_LIMIT_MAX / minute.
 *   /auth/login has its own stricter *global* cap (see routes/auth.js) so brute
 *   force can't be bypassed by rotating source IPs through the admin proxy.
 *
 * Env:
 *   RATE_LIMIT_MAX         anon requests / minute        (default 300)
 *   RATE_LIMIT_LOGIN_MAX   login attempts / minute total (default 15)
 *   RATE_LIMIT_ALLOWLIST   comma-separated IPs, always exempt
 */
const jwt = require('jsonwebtoken');
const jwtSecret = require('./jwt-secret');

const MAX       = Number(process.env.RATE_LIMIT_MAX || 300);
const LOGIN_MAX = Number(process.env.RATE_LIMIT_LOGIN_MAX || 15);
const ALLOWLIST = new Set(
  (process.env.RATE_LIMIT_ALLOWLIST || '').split(',').map(s => s.trim()).filter(Boolean)
);

// Paths that must NEVER be throttled — the WP plugin hits these unauthenticated,
// per visitor, from the WP server.
function isPublicPluginPath(url) {
  const p = (url || '').split('?')[0];
  return p === '/' || p === '/health' || p === '/languages' || p.startsWith('/languages/');
}

function hasValidToken(req) {
  const a = req.headers.authorization || '';
  if (!a.startsWith('Bearer ')) return false;
  try { jwt.verify(a.slice(7), jwtSecret()); return true; } catch { return false; }
}

// Global allowList: return true to SKIP the limiter for this request.
function allowList(req /*, key */) {
  if (isPublicPluginPath(req.url)) return true;
  if (ALLOWLIST.has(req.ip)) return true;
  if (hasValidToken(req)) return true;
  return false;
}

// Global registration options for @fastify/rate-limit.
const globalOptions = {
  global: true,
  max: MAX,
  timeWindow: '1 minute',
  allowList,
  // Uniform 429 shape. statusCode must be set or Fastify's error handler
  // defaults the thrown object to 500.
  errorResponseBuilder: (req, ctx) => ({
    statusCode: 429,
    error: 'Too many requests',
    retryAfter: Math.ceil(ctx.ttl / 1000),
  }),
};

// Per-route override for /auth/login: strict, and keyed to a single global
// bucket so an attacker cannot dodge it by rotating IPs (login is proxied
// through the admin server anyway, so every attempt shares one source IP).
// allowList:false ensures even allowlisted/first-party IPs are still capped here.
const loginOptions = {
  max: LOGIN_MAX,
  timeWindow: '1 minute',
  allowList: () => false,
  keyGenerator: () => 'auth-login',
};

module.exports = { globalOptions, loginOptions, allowList, MAX, LOGIN_MAX };
