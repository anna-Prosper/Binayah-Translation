'use strict';
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const FREQ_PATH = path.join(__dirname, '../string-frequency.json');

let _mem   = null;
let _dirty = false;
let _timer = null;

function load() {
  if (_mem) return _mem;
  try { _mem = JSON.parse(fs.readFileSync(FREQ_PATH, 'utf8')); }
  catch { _mem = {}; }
  return _mem;
}

function scheduleFlush() {
  if (_timer) return;
  _timer = setTimeout(() => {
    _timer = null;
    if (!_dirty) return;
    try { fs.writeFileSync(FREQ_PATH, JSON.stringify(_mem)); _dirty = false; }
    catch {}
  }, 2000);
}

function key(text, lang) {
  return crypto.createHash('md5').update(text + '\x00' + lang).digest('hex');
}

// Record that this text+lang was translated for page_id.
// Stores the translation and accumulates distinct page_ids.
function record(text, lang, translation, page_id) {
  if (!text || !translation || translation === text) return;
  const data = load();
  const k = key(text, lang);
  if (!data[k]) {
    data[k] = { lang, translation, page_ids: [] };
  }
  // Update translation if it changed (e.g. corrected via force-retranslate)
  if (data[k].translation !== translation) {
    data[k].translation = translation;
    _dirty = true;
  }
  if (!data[k].page_ids.includes(page_id)) {
    data[k].page_ids.push(page_id);
    _dirty = true;
    scheduleFlush();
  }
}

// Returns the cached translation only if this text has appeared on >= threshold pages,
// meaning it's a global/repeated string (header, footer, nav). Otherwise returns null.
function getGlobal(text, lang, threshold) {
  const data = load();
  const k = key(text, lang);
  const entry = data[k];
  if (!entry || entry.page_ids.length < threshold) return null;
  return entry.translation;
}

function stats() {
  const data = load();
  const entries = Object.values(data);
  const byLang = {};
  entries.forEach(e => {
    if (!byLang[e.lang]) byLang[e.lang] = { total: 0, global: 0 };
    byLang[e.lang].total++;
    if (e.page_ids.length >= 3) byLang[e.lang].global++;
  });
  return {
    total_entries:  entries.length,
    global_strings: entries.filter(e => e.page_ids.length >= 3).length,
    by_lang:        byLang,
  };
}

module.exports = { record, getGlobal, stats };
