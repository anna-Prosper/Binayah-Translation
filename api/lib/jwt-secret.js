'use strict';
/**
 * Dedicated JWT signing/verification secret, decoupled from the admin password.
 *
 * Set a long random JWT_SECRET in the environment. Until it's set, we fall back
 * to ADMIN_SECRET so existing deployments keep working (no lockout) — but that
 * fallback still reuses the password as the signing key, so setting a distinct
 * JWT_SECRET is what actually completes the separation. When you set JWT_SECRET,
 * all existing tokens become invalid and users simply log in again.
 *
 * Exposed as a function (not a captured constant) so a runtime env reload
 * (settings.js re-reads .env) is picked up.
 */
module.exports = function jwtSecret() {
  return process.env.JWT_SECRET || process.env.ADMIN_SECRET;
};
