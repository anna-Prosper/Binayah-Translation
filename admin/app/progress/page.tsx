'use client';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import Shell, { D, Alert } from '../components/Shell';
import { FlagImg, useLanguages } from '../lib/useLanguages';

interface Job {
  job_id: string; status: string; progress: number; total: number;
  page_title: string; current_lang: string; current_field: string;
  results: any[] | null; error: string | null; stopped?: boolean; paused?: boolean;
  user_id?: string; user_name?: string;
}

function PauseIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="currentColor">
      <rect x={6} y={4} width={4} height={16} rx={1}/><rect x={14} y={4} width={4} height={16} rx={1}/>
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
  );
}
function StopIcon() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="currentColor">
      <rect x={3} y={3} width={18} height={18} rx={2}/>
    </svg>
  );
}
function RefreshSvg({ spinning }: { spinning: boolean }) {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
      style={{ animation: spinning ? 'bt-spin 0.7s linear infinite' : 'none' }}>
      <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  );
}

const STATUS_CFG: Record<string, { bg: string; color: string; border: string; label: string; dot: string }> = {
  running: { bg: 'rgba(59,130,246,0.08)',   color: '#2563eb', border: 'rgba(59,130,246,0.25)', label: 'Running', dot: '#3b82f6' },
  paused:  { bg: 'rgba(245,158,11,0.08)',   color: '#d97706', border: 'rgba(245,158,11,0.25)', label: 'Paused',  dot: '#f59e0b' },
  done:    { bg: 'rgba(16,185,129,0.08)',   color: '#059669', border: 'rgba(16,185,129,0.25)', label: 'Done',    dot: '#10b981' },
  error:   { bg: 'rgba(239,68,68,0.08)',    color: '#dc2626', border: 'rgba(239,68,68,0.25)',  label: 'Error',   dot: '#ef4444' },
  stopped: { bg: 'rgba(100,116,139,0.08)',  color: '#64748b', border: 'rgba(100,116,139,0.25)',label: 'Stopped', dot: '#94a3b8' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.running;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.dot, display: 'inline-block', flexShrink: 0,
        animation: status === 'running' ? 'bt-pulse 2s ease-in-out infinite' : 'none' }} />
      {cfg.label}
    </span>
  );
}

export default function ProgressPage() {
  const { languages } = useLanguages();
  const [jobs,      setJobs]      = useState<Job[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);
  const [alert,     setAlert]     = useState<{ text: string; ok: boolean } | null>(null);
  const [acting,    setActing]    = useState<Set<string>>(new Set());
  const [filterUser,setFilterUser]= useState('');
  const pollRef = useRef<ReturnType<typeof setInterval>|null>(null);

  function showMsg(t: string, ok: boolean) { setAlert({ text: t, ok }); setTimeout(() => setAlert(null), 4000); }

  // Decode JWT for user identity and superadmin detection
  const _jwtP = typeof window !== 'undefined' ? (() => {
    try {
      const t = localStorage.getItem('bt_token') || '';
      if (!t) return null;
      const b = t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      return JSON.parse(atob(b.padEnd(b.length+(4-b.length%4)%4,'=')));
    } catch { return null; }
  })() : null;
  const _isSuperAdmin = !!(_jwtP && (_jwtP.role === 'superadmin' || _jwtP.admin));
  const _userId = _isSuperAdmin ? '' : (_jwtP ? (_jwtP.userId || '') : '');

  const loadJobs = useCallback(async () => {
    try {
      const data = await fetch('/api/translate/jobs').then(r => r.json());
      if (Array.isArray(data)) {
        const filtered = _userId ? data.filter((j: any) => (j.user_id || 'system') === _userId) : data;
        setJobs(filtered);
      }
    } catch {}
    setLoading(false);
  }, []);

  async function refresh() {
    setRefreshing(true);
    await loadJobs();
    setTimeout(() => setRefreshing(false), 500);
  }

  useEffect(() => { loadJobs(); }, [loadJobs]);

  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    const hasActive = jobs.some(j => j.status === 'running' || j.status === 'paused');
    if (hasActive) {
      pollRef.current = setInterval(loadJobs, 2000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobs, loadJobs]);

  async function pauseJob(job_id: string) {
    setActing(s => new Set(s).add(job_id));
    try {
      await fetch(`/api/translate/pause/${job_id}`, { method: 'POST' });
      await loadJobs(); showMsg('Job paused.', true);
    } catch { showMsg('Failed to pause', false); }
    setActing(s => { const n = new Set(s); n.delete(job_id); return n; });
  }

  async function resumeJob(job_id: string) {
    setActing(s => new Set(s).add(job_id));
    try {
      await fetch(`/api/translate/resume/${job_id}`, { method: 'POST' });
      await loadJobs(); showMsg('Job resumed.', true);
    } catch { showMsg('Failed to resume', false); }
    setActing(s => { const n = new Set(s); n.delete(job_id); return n; });
  }

  async function stopJob(job_id: string) {
    setActing(s => new Set(s).add(job_id));
    try {
      await fetch(`/api/translate/stop/${job_id}`, {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('bt_token') || '') },
      });
      await loadJobs(); showMsg('Job stopped.', true);
    } catch { showMsg('Failed to stop job', false); }
    setActing(s => { const n = new Set(s); n.delete(job_id); return n; });
  }

  async function pauseAll() {
    try {
      const res = await fetch('/api/translate/pause-all', { method: 'POST' }).then(r => r.json());
      await loadJobs(); showMsg(`Paused ${res.paused || 0} job(s).`, true);
    } catch { showMsg('Failed', false); }
  }

  async function resumeAll() {
    try {
      const res = await fetch('/api/translate/resume-all', { method: 'POST' }).then(r => r.json());
      await loadJobs(); showMsg(`Resumed ${res.resumed || 0} job(s).`, true);
    } catch { showMsg('Failed', false); }
  }

  async function stopAll() {
    try {
      const res = await fetch('/api/translate/stop-all', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('bt_token') || '') },
      }).then(r => r.json());
      await loadJobs(); showMsg(`Stopped ${res.stopped || 0} job(s).`, true);
    } catch { showMsg('Failed to stop all', false); }
  }

  function getLang(code: string) { return languages.find(l => l.code === code); }

  // Superadmin: get unique user list and apply filter
  const jobUsers = _isSuperAdmin ? Array.from(new Set(jobs.map((j: Job) => j.user_name || '').filter(Boolean))) as string[] : [];
  const filteredJobs = (_isSuperAdmin && filterUser) ? jobs.filter((j: Job) => j.user_name === filterUser) : jobs;
  const runningCount = filteredJobs.filter(j => j.status === 'running').length;
  const pausedCount  = filteredJobs.filter(j => j.status === 'paused').length;
  const activeCount  = runningCount + pausedCount;

  return (
    <Shell>
      <style>{`
        @keyframes bt-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes bt-pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
      `}</style>

      <Alert msg={alert} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 12 }}>
        <div>
          <h1 style={D.pageTitle}>Translation Progress</h1>
          <p style={D.pageSub}>Monitor, pause, resume, and stop translation jobs.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {runningCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#2563eb', fontWeight: '600', padding: '0 4px' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#3b82f6', display: 'inline-block', animation: 'bt-pulse 1.5s ease-in-out infinite' }} />
              {runningCount} running
            </div>
          )}
          {pausedCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#d97706', fontWeight: '600', padding: '0 4px' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
              {pausedCount} paused
            </div>
          )}
          <button type="button" onClick={refresh} style={{ ...D.btnSecondary, gap: 6 }}>
            <RefreshSvg spinning={refreshing} /> Refresh
          </button>
          {pausedCount > 0 && (
            <button type="button" onClick={resumeAll} style={{ ...D.btnSecondary, color: '#059669', borderColor: 'rgba(16,185,129,0.4)', gap: 6 }}>
              <PlayIcon /> Resume All
            </button>
          )}
          {runningCount > 0 && (
            <button type="button" onClick={pauseAll} style={{ ...D.btnSecondary, color: '#d97706', borderColor: 'rgba(245,158,11,0.4)', gap: 6 }}>
              <PauseIcon /> Pause All
            </button>
          )}
          {activeCount > 0 && (
            <button type="button" onClick={stopAll} style={{ ...D.btnDanger, background: '#dc2626', color: '#fff', border: 'none', gap: 6 }}>
              <StopIcon /> Stop All ({activeCount})
            </button>
          )}
        </div>
      </div>

      {/* Superadmin: user filter tabs */}
      {_isSuperAdmin && jobUsers.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: D.text3, letterSpacing: '0.05em', marginRight: 2 }}>FILTER:</span>
          <button type="button" onClick={() => setFilterUser('')}
            style={{ padding: '4px 14px', borderRadius: 99, fontSize: 12, fontWeight: 600, border: filterUser === '' ? 'none' : '1px solid #e2e8f0', cursor: 'pointer', background: filterUser === '' ? D.brand : 'transparent', color: filterUser === '' ? '#fff' : D.text2 }}>
            All ({jobs.length})
          </button>
          {jobUsers.map((u: string) => (
            <button key={u} type="button" onClick={() => setFilterUser(filterUser === u ? '' : u)}
              style={{ padding: '4px 14px', borderRadius: 99, fontSize: 12, fontWeight: 600, border: filterUser === u ? 'none' : '1px solid #e2e8f0', cursor: 'pointer', background: filterUser === u ? '#7c3aed' : 'transparent', color: filterUser === u ? '#fff' : D.text2, display: 'flex', alignItems: 'center', gap: 5 }}>
              <svg width={10} height={10} viewBox="0 0 24 24" fill="currentColor"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              {u} ({jobs.filter((j: Job) => j.user_name === u).length})
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ ...D.card, padding: 40, textAlign: 'center', color: D.text3 }}>Loading jobs...</div>
      ) : filteredJobs.length === 0 ? (
        <div style={{ ...D.cardLg, padding: 64, textAlign: 'center' }}>
          <svg width={52} height={52} viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth={1.5} strokeLinecap="round" style={{ margin: '0 auto 16px', display: 'block' }}>
            <circle cx={12} cy={12} r={10}/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <div style={{ fontSize: 15, fontWeight: '600', color: D.text2, marginBottom: 6 }}>No Jobs</div>
          <div style={{ fontSize: 13, color: D.text3 }}>Start a translation from the Pages section to see jobs here.</div>
          <div style={{ fontSize: 12, color: D.text3, marginTop: 8 }}>Jobs are stored in memory — they reset when the server restarts.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filteredJobs.map(job => {
            const pct       = job.total > 0 ? Math.round((job.progress / job.total) * 100) : 0;
            const li        = getLang(job.current_lang);
            const isAct     = acting.has(job.job_id);
            const isRunning = job.status === 'running';
            const isPaused  = job.status === 'paused';
            const isDone    = job.status === 'done';
            const isError   = job.status === 'error';
            const isStopped = job.status === 'stopped';
            const barColor  = isDone ? '#10b981' : isError ? '#ef4444' : isPaused ? '#f59e0b' : isStopped ? '#94a3b8' : '#004D42';
            const cfg       = STATUS_CFG[job.status] || STATUS_CFG.running;

            return (
              <div key={job.job_id} style={{
                ...D.card,
                borderLeft: `3px solid ${cfg.dot}`,
                background: isPaused ? 'rgba(245,158,11,0.02)' : isDone ? 'rgba(16,185,129,0.02)' : '#fff',
                padding: '16px 20px',
              }}>
                {/* Top row: title + status badge + actions */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: '600', fontSize: 14, color: D.text1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>
                      {job.page_title || 'Unnamed Job'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <StatusBadge status={job.status} />
                      {_isSuperAdmin && job.user_name && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 99, background: '#f3e8ff', color: '#7c3aed', border: '1px solid rgba(124,58,237,0.25)', whiteSpace: 'nowrap' }}>
                          <svg width={9} height={9} viewBox="0 0 24 24" fill="currentColor"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                          {job.user_name}
                        </span>
                      )}
                      {job.current_lang && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: D.text2 }}>
                          {li ? <FlagImg flag={li.flag} size={13} /> : null}
                          <span style={{ fontWeight: '600', textTransform: 'uppercase' }}>{job.current_lang}</span>
                        </div>
                      )}
                      <span style={{ fontSize: 11, color: D.text3, fontFamily: 'monospace' }}>#{job.job_id.slice(0,8)}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                    {isRunning && (
                      <button type="button" onClick={() => pauseJob(job.job_id)} disabled={isAct}
                        title="Pause this job"
                        style={{ ...D.btnSecondary, padding: '5px 12px', fontSize: 12, gap: 5, color: '#d97706', borderColor: 'rgba(245,158,11,0.4)', opacity: isAct ? 0.5 : 1 }}>
                        <PauseIcon /> Pause
                      </button>
                    )}
                    {isPaused && (
                      <button type="button" onClick={() => resumeJob(job.job_id)} disabled={isAct}
                        title="Resume this job"
                        style={{ ...D.btnPrimary, padding: '5px 12px', fontSize: 12, gap: 5, background: '#059669', opacity: isAct ? 0.5 : 1 }}>
                        <PlayIcon /> Resume
                      </button>
                    )}
                    {(isRunning || isPaused) && (
                      <button type="button" onClick={() => stopJob(job.job_id)} disabled={isAct}
                        title="Stop this job"
                        style={{ ...D.btnDanger, padding: '5px 12px', fontSize: 12, gap: 5, opacity: isAct ? 0.5 : 1 }}>
                        <StopIcon /> Stop
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div style={{ marginBottom: job.current_field || job.error || (isDone && job.results) ? 8 : 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, background: '#e2e8f0', borderRadius: 99, height: 6, overflow: 'hidden' }}>
                      <div style={{ height: 6, borderRadius: 99, width: pct + '%', background: barColor, transition: 'width 0.4s ease' }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: '700', color: D.text1, minWidth: 42, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {pct}%
                    </span>
                    <span style={{ fontSize: 11, color: D.text3, minWidth: 60, fontVariantNumeric: 'tabular-nums' }}>
                      {job.progress} / {job.total}
                    </span>
                  </div>
                </div>

                {/* Current field / status line */}
                {(isRunning || isPaused) && job.current_field && (
                  <div style={{ fontSize: 11, color: D.text3 }}>
                    {isPaused ? 'Paused at: ' : 'Translating: '}
                    <code style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 3, color: D.brand, fontSize: 11 }}>{job.current_field}</code>
                  </div>
                )}

                {/* Results */}
                {isDone && job.results && job.results.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                    {job.results.map((r, i) => {
                      const rl = getLang(r.language);
                      return (
                        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '2px 8px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 99, color: '#059669' }}>
                          {rl ? <FlagImg flag={rl.flag} size={11} /> : null}
                          {r.translated} fields
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Error */}
                {isError && job.error && (
                  <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4, padding: '6px 10px', background: 'rgba(239,68,68,0.06)', borderRadius: 5, border: '1px solid rgba(239,68,68,0.15)' }}>
                    {job.error}
                  </div>
                )}

                {/* Stopped message with hint */}
                {isStopped && (
                  <div style={{ fontSize: 11, color: D.text3, marginTop: 4 }}>
                    Stopped at {pct}% — Start a new translation from Pages to retranslate this page.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
