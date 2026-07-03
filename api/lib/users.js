'use strict';
const fs      = require('fs');
const bcrypt  = require('bcryptjs');
const dataDir = require('./data-dir');

const FILE = dataDir('users.json');
const { atomicWrite } = require('./atomic-json');

function read()          { try { return JSON.parse(fs.readFileSync(FILE,'utf8')); } catch { return []; } }
function write(users)    { atomicWrite(FILE, JSON.stringify(users, null, 2)); }
function byId(id)        { return read().find(u => u.id === id) || null; }
function byUsername(usr) { return read().find(u => u.username.toLowerCase() === usr.toLowerCase()) || null; }
const hash   = (p)    => bcrypt.hash(p, 10);
const verify = (p, h) => bcrypt.compare(p, h);

function safe(u) { const { password_hash, ...rest } = u; return rest; }

/* permission helpers */
function isSuperAdmin(u)          { return u?.role === 'superadmin' || u?.admin === true; }
function canModule(u, mod)        { if (!u) return false; if (isSuperAdmin(u)) return true; return (u.permissions?.modules||[]).includes(mod); }
function langAllowed(u, code)     { if (!u || isSuperAdmin(u)) return true; const a=u.permissions?.languages||[]; return !a.length || a.includes(code); }
function postTypeAllowed(u, slug) { if (!u || isSuperAdmin(u)) return true; const a=u.permissions?.post_types||[]; return !a.length || a.includes(slug); }
function modelAllowed(u, model)   { if (!u || isSuperAdmin(u)) return true; const a=u.permissions?.models||[]; return !a.length || a.includes(model); }

async function initSuperAdmin() {
  const users = read();
  if (users.length === 0) {
    if (!process.env.ADMIN_SECRET) {
      console.error('[Users] ADMIN_SECRET not set — refusing to seed a default superadmin with a hardcoded password. Set ADMIN_SECRET and restart.');
      return;
    }
    const h = await hash(process.env.ADMIN_SECRET);
    write([{
      id: 'superadmin',
      username: 'admin',
      password_hash: h,
      role: 'superadmin',
      created_at: new Date().toISOString(),
      last_login: null,
      permissions: { modules: [], languages: [], post_types: [], models: [] }
    }]);
    console.log('[Users] default superadmin created');
  }
}

module.exports = { read, write, byId, byUsername, hash, verify, safe, isSuperAdmin, canModule, langAllowed, postTypeAllowed, modelAllowed, initSuperAdmin };
