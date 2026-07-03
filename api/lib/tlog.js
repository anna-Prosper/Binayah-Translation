'use strict';
const fs      = require('fs');
const dataDir = require('../lib/data-dir');

// Append-only translation log. One JSON object per line (JSONL). Appending is
// O(1) and never rewrites the whole file, so there is no 5000-row cap and no
// per-append rewrite cost during large bulk runs. The previous design capped at
// 5000 rows (dropping history) AND rewrote the full array on every append.
const LOG_JSONL = dataDir('translation-log.jsonl');
const LOG_JSON  = dataDir('translation-log.json'); // legacy array file (migrated once)

let _migrated = false;
function migrateOnce() {
  if (_migrated) return;
  _migrated = true;
  try {
    if (!fs.existsSync(LOG_JSONL) && fs.existsSync(LOG_JSON)) {
      const arr = JSON.parse(fs.readFileSync(LOG_JSON, 'utf8'));
      if (Array.isArray(arr) && arr.length) {
        // Legacy array was newest-first; write oldest-first so appends stay chronological.
        const lines = arr.slice().reverse().map(e => JSON.stringify(e)).join('\n') + '\n';
        fs.writeFileSync(LOG_JSONL, lines);
      }
    }
  } catch { /* best effort */ }
}

function append(entry) {
  try {
    migrateOnce();
    fs.appendFileSync(LOG_JSONL, JSON.stringify(entry) + '\n');
  } catch (e) { /* logging must never break a translation */ }
}

/**
 * Return log entries newest-first (matching the old array order the readers
 * expect). `limit` caps how many recent entries are returned.
 */
function readAll(limit) {
  migrateOnce();
  let raw;
  try { raw = fs.readFileSync(LOG_JSONL, 'utf8'); }
  catch { return []; }
  const out = [];
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {          // newest-first
    const line = lines[i];
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip corrupt line */ }
    if (limit && out.length >= limit) break;
  }
  return out;
}

module.exports = { append, readAll, LOG_JSONL };
