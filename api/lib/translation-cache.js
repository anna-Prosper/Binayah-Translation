'use strict';
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const CACHE_PATH = path.join(__dirname, '../translation-cache.json');

// In-memory cache — loaded once, written back after each save
let _mem  = null;
let _dirty = false;
let _flushTimer = null;

function load() {
  if (_mem) return _mem;
  try { _mem = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')); }
  catch { _mem = {}; }
  return _mem;
}

function schedulFlush() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    if (!_dirty) return;
    try { fs.writeFileSync(CACHE_PATH, JSON.stringify(_mem)); _dirty = false; }
    catch {}
  }, 2000); // batch writes — flush 2s after last change
}

function key(text, lang) {
  return crypto.createHash('md5').update(text + '\x00' + lang).digest('hex');
}

// Returns cached translated text, or null if not in cache
function get(text, lang) {
  const cache = load();
  const k = key(text, lang);
  const entry = cache[k];
  if (!entry) return null;
  entry.hits = (entry.hits || 0) + 1;
  entry.last_used = new Date().toISOString();
  _dirty = true;
  schedulFlush();
  return entry.translated;
}

// Store a new translation in cache
function set(text, lang, translated) {
  if (!translated || translated === text) return;
  const cache = load();
  const k = key(text, lang);
  if (!cache[k]) {
    cache[k] = {
      translated,
      lang,
      hits:      0,
      created:   new Date().toISOString(),
      last_used: new Date().toISOString(),
    };
    _dirty = true;
    schedulFlush();
  }
}

function stats() {
  const cache = load();
  const entries = Object.values(cache);
  return {
    total_entries: entries.length,
    total_hits:    entries.reduce((s, e) => s + (e.hits || 0), 0),
    by_lang:       entries.reduce((m, e) => { m[e.lang] = (m[e.lang] || 0) + 1; return m; }, {}),
  };
}

function clear() {
  _mem = {};
  _dirty = true;
  try { fs.writeFileSync(CACHE_PATH, '{}'); _dirty = false; } catch {}
}

module.exports = { get, set, stats, clear };
