'use strict';
const dataDir = require('./data-dir');
const { writeJSON, readJSON } = require('./atomic-json');

// Persistent job store. Jobs used to live only in an in-memory Map, so a server
// restart/redeploy mid-run lost them: /progress returned not_found and the admin
// UI hung forever. This keeps the live Map for fast progress updates but also
// snapshots it to disk atomically, and on boot marks any job that was still
// running/paused as "interrupted" (the actual work died with the old process).
const STORE = dataDir('jobs.json');
const _jobs = new Map();

// ── Boot: reload + reconcile ────────────────────────────────────────────────
(function init() {
  const saved = readJSON(STORE, {});
  for (const [id, job] of Object.entries(saved || {})) {
    if (!job) continue;
    if (job.status === 'running' || job.status === 'paused') {
      // The process that was running this died — reflect that instead of hanging.
      job.status = 'interrupted';
      job.error  = job.error || 'Server restarted while this job was running.';
      _jobs.set(id, job);
    }
    // Drop already-terminal jobs (done/error/stopped/interrupted) from before the
    // restart so jobs.json doesn't accumulate forever. Live history is in the log.
  }
})();

let _dirty = false;
function hasActive() {
  for (const j of _jobs.values()) if (j && (j.status === 'running' || j.status === 'paused')) return true;
  return false;
}
function snapshot() {
  // Persist when a set/delete marked us dirty, OR whenever a job is active — job
  // objects mutate in place (progress/current_field), so an active job means there
  // is fresh progress to capture even though _dirty wasn't set.
  if (!_dirty && !hasActive()) return;
  _dirty = false;
  try { writeJSON(STORE, Object.fromEntries(_jobs)); } catch { /* best effort */ }
}
// Periodic snapshot captures in-place progress; also flushed on set/delete/exit.
const _timer = setInterval(snapshot, 3000);
if (_timer.unref) _timer.unref();
for (const sig of ['SIGTERM', 'SIGINT', 'beforeExit']) {
  process.on(sig, () => { try { snapshot(); } catch {} });
}

function markDirty() { _dirty = true; }

// ── Map-compatible API (drop-in for the old `new Map()`) ────────────────────
module.exports = {
  set(id, job) { _jobs.set(id, job); _dirty = true; snapshot(); return this; },
  get(id)      { return _jobs.get(id); },
  delete(id)   { const r = _jobs.delete(id); _dirty = true; return r; },
  entries()    { return _jobs.entries(); },
  has(id)      { return _jobs.has(id); },
  markDirty,           // call after a status transition to force a prompt snapshot
  flush: snapshot,
};
