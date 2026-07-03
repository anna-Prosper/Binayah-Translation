'use strict';
const fs = require('fs');

/**
 * Atomic file helpers. Writing to a temp file in the same directory and then
 * rename()-ing over the target is atomic on POSIX, so a crash mid-write can
 * never leave a truncated/corrupt file (which readers would silently treat as
 * empty). Use for every JSON state file the API persists.
 */
function atomicWrite(filePath, data) {
  const tmp = filePath + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filePath);
}

function writeJSON(filePath, obj, pretty) {
  atomicWrite(filePath, JSON.stringify(obj, null, pretty ? 2 : 0));
}

function readJSON(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return typeof fallback === 'function' ? fallback() : fallback; }
}

module.exports = { atomicWrite, writeJSON, readJSON };
