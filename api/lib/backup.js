'use strict';
/**
 * Periodic snapshots of the whole DATA_DIR (all flat-JSON state + WP creds).
 *
 * The API keeps every bit of durable state as flat JSON on a single Render
 * persistent disk. There is no database and no external replica, so a bad write
 * or an accidental file wipe is unrecoverable. This module takes rotating zip
 * snapshots of DATA_DIR into DATA_DIR/backups/ and exposes them for offsite pull
 * (routes/backup.js). In-disk snapshots protect against corruption / bad writes;
 * to also survive disk loss, pull the export zip offsite on a cron (see DEPLOY.md).
 *
 * Env:
 *   BACKUP_INTERVAL_HOURS  how often to snapshot   (default 6, 0 disables schedule)
 *   BACKUP_KEEP            how many snapshots kept  (default 48)
 */
const fs   = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const dataDir = require('./data-dir');

const BACKUP_SUBDIR = 'backups';
const INTERVAL_HOURS = Number(process.env.BACKUP_INTERVAL_HOURS || 6);
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP || 48));

function backupsRoot() { return dataDir(BACKUP_SUBDIR); }

// Timestamp safe for filenames (no colons): 2026-07-10T14-05-09-123Z
function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// Recursively collect files under DATA_DIR, skipping the backups dir itself,
// node_modules, and half-written *.tmp files.
function collectFiles(dir, base, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const rel = path.relative(base, abs);
    if (e.isDirectory()) {
      if (e.name === BACKUP_SUBDIR || e.name === 'node_modules' || e.name === '.git') continue;
      collectFiles(abs, base, out);
    } else if (e.isFile()) {
      if (e.name.endsWith('.tmp')) continue;
      out.push({ abs, rel });
    }
  }
  return out;
}

// Create one snapshot zip. Written atomically (tmp + rename) so a crash mid-zip
// never leaves a truncated archive that looks like a valid backup.
function createSnapshot() {
  const base = dataDir();
  const root = backupsRoot();
  fs.mkdirSync(root, { recursive: true });

  const files = collectFiles(base, base, []);
  if (!files.length) return null;

  const zip = new AdmZip();
  for (const f of files) {
    try { zip.addLocalFile(f.abs, path.dirname(f.rel) === '.' ? '' : path.dirname(f.rel)); }
    catch { /* skip a file that vanished mid-run */ }
  }

  const name = `backup-${stamp()}.zip`;
  const dest = path.join(root, name);
  const tmp = dest + '.' + process.pid + '.tmp';
  zip.writeZip(tmp);
  fs.renameSync(tmp, dest);

  rotate();
  return { name, size: fs.statSync(dest).size, files: files.length };
}

// Keep only the newest KEEP snapshots.
function listSnapshots() {
  let names;
  try { names = fs.readdirSync(backupsRoot()); }
  catch { return []; }
  return names
    .filter(n => n.startsWith('backup-') && n.endsWith('.zip'))
    .map(n => {
      const st = fs.statSync(path.join(backupsRoot(), n));
      return { name: n, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function rotate() {
  const snaps = listSnapshots();
  for (const s of snaps.slice(KEEP)) {
    try { fs.unlinkSync(path.join(backupsRoot(), s.name)); } catch { /* ignore */ }
  }
}

function snapshotPath(name) {
  // Guard against path traversal — only a plain backup file basename is allowed.
  if (!/^backup-[\w.-]+\.zip$/.test(name)) return null;
  const p = path.join(backupsRoot(), name);
  return fs.existsSync(p) ? p : null;
}

let timer = null;
function startSchedule(logger) {
  const log = (m) => { try { (logger || console).info ? logger.info(m) : console.log(m); } catch { console.log(m); } };
  if (INTERVAL_HOURS <= 0) { log('[backup] schedule disabled (BACKUP_INTERVAL_HOURS=0)'); return; }
  // One snapshot shortly after boot, then on the interval.
  setTimeout(() => {
    try { const r = createSnapshot(); if (r) log(`[backup] boot snapshot ${r.name} (${r.files} files, ${r.size}b)`); }
    catch (e) { log('[backup] boot snapshot failed: ' + e.message); }
  }, 10000).unref?.();
  timer = setInterval(() => {
    try { const r = createSnapshot(); if (r) log(`[backup] snapshot ${r.name} (${r.files} files, ${r.size}b)`); }
    catch (e) { log('[backup] snapshot failed: ' + e.message); }
  }, INTERVAL_HOURS * 3600 * 1000);
  timer.unref?.();
  log(`[backup] every ${INTERVAL_HOURS}h, keep ${KEEP}`);
}

module.exports = { createSnapshot, listSnapshots, snapshotPath, startSchedule, backupsRoot };
