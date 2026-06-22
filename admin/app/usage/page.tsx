'use client';
import React, { useEffect, useState, useCallback } from 'react';
import Shell, { D } from '../components/Shell';

interface LogEntry {
  id:            string;
  job_id:        string;
  timestamp:     string;
  post_id:       number;
  post_title:    string;
  post_type:     string;
  post_url:      string;
  language:      string;
  languages:     string[];  // grouped: all languages in this job
  api:           string;
  model:         string;
  fields_count:  number;
  tokens_used:   number;
  input_tokens:  number;
  output_tokens: number;
  status:        string;
  user_id:       string;
  user_name:     string;
  entries:       any[];    // per-language sub-entries
  times_translated: number;
}
interface Summary {
  total_jobs:    number;
  total_fields:  number;
  total_tokens:  number;
  by_api:        Record<string, number>;
  by_model:      Record<string, number>;
  by_language:   Record<string, number>;
  by_user:       Record<string, number>;
}
interface UserItem { id: string; username: string; role: string; }
interface PageStats {
  summary: {
    post_id: number; post_title: string; post_type: string;
    total_jobs: number; total_fields: number; total_tokens: number; post_url: string;
    by_language: Record<string,number>; by_model: Record<string,number>; by_api: Record<string,number>;
  };
  jobs: LogEntry[];
}

const PER_PAGE = 50;
const API_COLORS: Record<string, string> = {
  openrouter: '#6366f1',
  deepseek:   '#0ea5e9',
  openai:     '#10b981',
  unknown:    '#94a3b8',
};
const apiColor = (a: string) => API_COLORS[a] || '#94a3b8';

// Pricing fetched live from backend /api/models/pricing
// Format: {model_id: {inp: $/M, out: $/M}}
function calcCost(model: string, inputTokens: number, outputTokens: number, pricing: Record<string,{inp:number,out:number}>): number | null {
  if (!model || (!inputTokens && !outputTokens)) return null;
  const p = pricing[model] ?? pricing[model.toLowerCase()] ?? null;
  if (!p) return null;
  return (inputTokens * p.inp + outputTokens * p.out) / 1_000_000;
}

function fmtCost(cost: number | null): string {
  if (cost === null) return '—';
  if (cost === 0) return '$0.000000';
  if (cost < 0.000001) return '<$0.000001';
  return '$' + cost.toFixed(6);
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={{ background: D.surface, border: `1px solid ${D.border}`, borderRadius: D.radius, padding: "18px 22px", minWidth: 160, flex: "1 1 160px" }}>
      <div style={{ fontSize: 12, color: D.text3, marginBottom: 6, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: D.text1, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: D.text3, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600,
      padding: "2px 8px", borderRadius: 4, background: color + "18", color, border: `1px solid ${color}33` }}>
      {text}
    </span>
  );
}

function fmt(ts: string) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function modelShort(m: string) {
  if (!m) return '—';
  const p = m.split('/');
  return p[p.length - 1] || m;
}

export default function UsagePage() {
  const _jwtP = typeof window !== 'undefined' ? (() => {
    try {
      const t = localStorage.getItem('bt_token') || '';
      if (!t) return null;
      const b = t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      return JSON.parse(atob(b.padEnd(b.length+(4-b.length%4)%4,'=')));
    } catch { return null; }
  })() : null;
  const _isSuperAdmin = !!(_jwtP && (_jwtP.role === 'superadmin' || _jwtP.admin));

  const [entries,    setEntries]    = useState<LogEntry[]>([]);
  const [summary,    setSummary]    = useState<Summary | null>(null);
  const [users,      setUsers]      = useState<UserItem[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [page,       setPage]       = useState(1);
  const [total,      setTotal]      = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Filters
  const [fApi,      setFApi]      = useState('');
  const [fUser,     setFUser]     = useState('');
  const [fSearch,   setFSearch]   = useState('');
  const [fPostType, setFPostType] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [pricing,    setPricing]    = useState<Record<string,{inp:number,out:number}>>({});
  const [pageModal,  setPageModal]  = useState<{post_id:number;title:string;url:string}|null>(null);
  const [pageUrls,    setPageUrls]    = useState<Record<string,string>>({});
  const [pageStats,  setPageStats]  = useState<PageStats|null>(null);
  const [statsLoad,  setStatsLoad]  = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const token = typeof window !== 'undefined' ? (localStorage.getItem('bt_token') || '') : '';
      const params = new URLSearchParams({
        page:     String(page),
        per_page: String(PER_PAGE),
      });
      if (fApi)      params.set('api',       fApi);
      if (fUser)     params.set('user_id',   fUser);
      if (fSearch)   params.set('search',    fSearch);
      if (fPostType) params.set('post_type', fPostType);

      const res  = await fetch(`/api/usage-log?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      setEntries(json.data       || []);
      setSummary(json.summary    || null);
      setUsers(json.users        || []);
      setTotal(json.total        || 0);
      setTotalPages(json.total_pages || 1);
    } catch { setEntries([]); } finally { setLoading(false); }
  }, [page, fApi, fUser, fSearch, fPostType]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Fetch real pricing from backend (OpenRouter API + DeepSeek)
  useEffect(() => {
    const token = typeof window !== 'undefined' ? (localStorage.getItem('bt_token') || '') : '';
    fetch('/api/models/pricing', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setPricing(d || {})).catch(() => {});
  }, []);

  async function openPageModal(post_id: number, title: string, url = '') {
    setPageModal({ post_id, title, url });
    setPageStats(null);
    setStatsLoad(true);
    try {
      const token = typeof window !== 'undefined' ? (localStorage.getItem('bt_token') || '') : '';
      const res  = await fetch(`/api/usage-log/page-stats?post_id=${post_id}`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      setPageStats(json);
      // Get URL: from passed arg → from page-stats summary → from WP API
      let resolvedUrl = url || (json.summary && json.summary.post_url) || '';
      if (!resolvedUrl) {
        try {
          const r2 = await fetch(`/api/page-url/${post_id}`, { headers: { Authorization: `Bearer ${token}` } });
          const d2 = await r2.json();
          resolvedUrl = d2.url || '';
        } catch {}
      }
      if (resolvedUrl) setPageModal(prev => prev ? { ...prev, url: resolvedUrl } : prev);
      // Fetch language-specific URLs
      try {
        const ru = await fetch(`/api/page-urls/${post_id}`, { headers: { Authorization: `Bearer ${token}` } });
        const ud = await ru.json();
        const baseUrl = ud.base_url || resolvedUrl || '';
        if (baseUrl) {
          // Build language URL map: use WP-provided urls, fallback to base_url + ?lang=code
          const langUrls: Record<string,string> = { ...(ud.urls || {}) };
          // For each language in translation history, ensure we have a URL
          (json.jobs || []).forEach((j: any) => {
            const lg = (j.language || '').toLowerCase();
            if (lg && !langUrls[lg]) {
              try { const u = new URL(baseUrl); langUrls[lg] = u.origin + '/' + lg + u.pathname; } catch { langUrls[lg] = baseUrl; }
            }
          });
          setPageUrls(langUrls);
        }
      } catch {}
    } catch { setPageStats(null); } finally { setStatsLoad(false); }
  }

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [fApi, fUser, fSearch, fPostType]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setFSearch(searchInput.trim());
  }

  function exportCSV() {
    const headers = _isSuperAdmin
      ? ['Date','Page Title','Post Type','Language','API','Model','Fields','Tokens','Cost (USD)','User','Status']
      : ['Date','Page Title','Post Type','Language','API','Model','Fields','Tokens','Cost (USD)','Status'];
    const rows = entries.map(e => {
      const cost = calcCost(e.model, e.input_tokens || 0, e.output_tokens || 0, pricing);
      const base = [
        fmt(e.timestamp),
        `"${(e.post_title || '').replace(/"/g,'""')}"`,
        e.post_type || '',
        (e.languages || [e.language]).filter(Boolean).join(';') || '',
        e.times_translated || 1,
        e.api       || '',
        e.model     || '',
        e.fields_count  || 0,
        e.tokens_used   || 0,
        cost !== null ? cost.toFixed(6) : '',
      ];
      if (_isSuperAdmin) base.push(`"${(e.user_name || e.user_id || '').replace(/"/g,'""')}"`);
      base.push(e.status || '');
      return base.join(',');
    });
    const csv  = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a'); a.href = url;
    a.download = `binayah-usage-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  const topApis = summary ? Object.entries(summary.by_api).sort((a,b)=>b[1]-a[1]).slice(0,3) : [];
  const topModels = summary ? Object.entries(summary.by_model).sort((a,b)=>b[1]-a[1]).slice(0,3) : [];

  const selStyle: React.CSSProperties = {
    height: 34, border: `1px solid ${D.border2}`, borderRadius: 6, padding: '0 10px',
    fontSize: 13, background: D.surface, color: D.text1, cursor: 'pointer',
  };
  const thS: React.CSSProperties = {
    textAlign: 'left', padding: '10px 12px', fontSize: 12, fontWeight: 600,
    color: D.text3, textTransform: 'capitalize', letterSpacing: '0.02em',
    borderBottom: `1px solid ${D.border}`, background: '#f8fafc', whiteSpace: 'nowrap',
  };
  const tdS: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: D.text2, verticalAlign: 'middle', borderBottom: `1px solid ${D.border}` };

  return (
    <Shell>
      <div style={{ maxWidth: 1300, margin: '0 auto', padding: '0 0 40px' }}>

        {/* - Summary cards - */}
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 24 }}>
          <StatCard label="Total Translations" value={summary ? summary.total_jobs.toLocaleString() : '—'} />
          <StatCard label="Fields Translated"  value={summary ? summary.total_fields.toLocaleString() : '—'} />
          <StatCard label="Tokens Used"
            value={summary ? (summary.total_tokens > 0 ? summary.total_tokens.toLocaleString() : '—') : '—'}
            sub={summary && summary.total_tokens === 0 ? 'Tracking active for new jobs' : undefined}
          />
          <StatCard
            label="Top API"
            value={topApis.length ? topApis[0][0] : '—'}
            sub={topApis.length ? `${topApis[0][1]} jobs` : undefined}
          />
          <StatCard
            label="Top Model"
            value={topModels.length ? modelShort(topModels[0][0]) : '—'}
            sub={topModels.length ? `${topModels[0][1]} jobs` : undefined}
          />
        </div>

        {/* - Breakdown pills - */}
        {summary && Object.keys(summary.by_api).length > 0 && (
          <div style={{ marginBottom: 20, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: D.text3, fontWeight: 600, marginRight: 4 }}>BY API</span>
            {Object.entries(summary.by_api).sort((a,b)=>b[1]-a[1]).map(([a,c]) => (
              <button key={a} onClick={() => setFApi(fApi === a ? '' : a)}
                style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${apiColor(a)}44`,
                  background: fApi === a ? apiColor(a) : apiColor(a) + '15',
                  color: fApi === a ? '#fff' : apiColor(a) }}>
                {a} · {c}
              </button>
            ))}
            {_isSuperAdmin && Object.keys(summary.by_user).length > 0 && (
              <>
                <span style={{ fontSize: 12, color: D.text3, fontWeight: 600, marginLeft: 12, marginRight: 4 }}>BY USER</span>
                {Object.entries(summary.by_user).sort((a,b)=>b[1]-a[1]).map(([u,c]) => (
                  <button key={u} onClick={() => { const uid = users.find(x=>x.username===u)?.id||u; setFUser(fUser===uid?'':uid); }}
                    style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
                      border: `1px solid ${D.border2}`,
                      background: fUser && (users.find(x=>x.id===fUser)?.username===u) ? D.brand : '#f1f5f9',
                      color: fUser && (users.find(x=>x.id===fUser)?.username===u) ? '#fff' : D.text2 }}>
                    {u} · {c}
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {/* - Filter bar - */}
        <div style={{ background: D.surface, border: `1px solid ${D.border}`, borderRadius: D.radius,
          padding: '14px 16px', marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>

          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 6 }}>
            <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
              placeholder="Search page name…"
              style={{ height: 34, border: `1px solid ${D.border2}`, borderRadius: 6, padding: '0 10px', fontSize: 13, width: 200 }} />
            <button type="submit" style={{ height: 34, padding: '0 14px', borderRadius: 6, border: 'none',
              background: D.brand, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Search</button>
            {fSearch && <button type="button" onClick={() => { setFSearch(''); setSearchInput(''); }}
              style={{ height: 34, padding: '0 10px', borderRadius: 6, border: `1px solid ${D.border2}`,
                background: '#fff', color: D.text3, fontSize: 13, cursor: 'pointer' }}>✕</button>}
          </form>

          <select value={fApi} onChange={e => setFApi(e.target.value)} style={selStyle}>
            <option value="">All APIs</option>
            <option value="openrouter">OpenRouter</option>
            <option value="deepseek">DeepSeek</option>
          </select>

          {_isSuperAdmin && users.length > 0 && (
            <select value={fUser} onChange={e => setFUser(e.target.value)} style={selStyle}>
              <option value="">All Users</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.username} ({u.role})</option>)}
            </select>
          )}

          {(fApi || fUser || fSearch || fPostType) && (
            <button onClick={() => { setFApi(''); setFUser(''); setFSearch(''); setSearchInput(''); setFPostType(''); }}
              style={{ height: 34, padding: '0 12px', borderRadius: 6, border: `1px solid ${D.border2}`,
                background: '#fff', color: D.text3, fontSize: 13, cursor: 'pointer' }}>
              Clear all
            </button>
          )}

          <div style={{ flex: 1 }} />

          <button onClick={exportCSV}
            style={{ height: 34, padding: '0 14px', borderRadius: 6, border: `1px solid ${D.border2}`,
              background: '#fff', color: D.text2, fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1={12} y1={15} x2={12} y2={3}/>
            </svg>
            Export CSV
          </button>
        </div>

        {/* - Table - */}
        <div style={{ background: D.surface, border: `1px solid ${D.border}`, borderRadius: D.radius, overflow: 'hidden' }}>
          {/* count bar */}
          <div style={{ padding: '10px 16px', borderBottom: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: D.text3 }}>
              {loading ? 'Loading…' : `${total.toLocaleString()} record${total !== 1 ? 's' : ''}`}
              {(fApi || fUser || fSearch) ? ' (filtered)' : ''}
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thS}>Last Translated</th>
                  <th style={thS}>Page Name</th>
                  <th style={thS}>Post Type</th>
                  <th style={thS}>Languages</th>
                  <th style={thS}>API</th>
                  <th style={thS}>Model</th>
                  <th style={{ ...thS, textAlign: 'right' }}>Times</th>
                  <th style={{ ...thS, textAlign: 'right' }}>Fields</th>
                  <th style={{ ...thS, textAlign: 'right' }}>Tokens</th>
                  <th style={{ ...thS, textAlign: 'right' }}>Cost</th>
                  {_isSuperAdmin && <th style={thS}>User</th>}

                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={_isSuperAdmin ? 11 : 10} style={{ ...tdS, textAlign: 'center', padding: 40, color: D.text3 }}>
                    Loading usage data…
                  </td></tr>
                )}
                {!loading && entries.length === 0 && (
                  <tr><td colSpan={_isSuperAdmin ? 11 : 10} style={{ ...tdS, textAlign: 'center', padding: 40, color: D.text3 }}>
                    {fApi || fUser || fSearch ? 'No records match the current filters.' : 'No translation jobs yet. Run a translation to see usage here.'}
                  </td></tr>
                )}
                {!loading && entries.map((e, i) => (
                  <tr key={e.id || i} style={{ background: i % 2 === 0 ? D.surface : '#fafbfc' }}>
                    <td style={{ ...tdS, whiteSpace: 'nowrap', fontSize: 12, color: D.text3 }}>{fmt(e.timestamp)}</td>
                    <td style={{ ...tdS, maxWidth: 260 }}>
                      <button onClick={() => openPageModal(e.post_id, e.post_title || '(no title)', e.post_url || '')}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                        <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: D.brand, textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}>
                          {e.post_title || '(no title)'}
                        </div>
                        <div style={{ fontSize: 11, color: D.text3, marginTop: 1 }}>ID {e.post_id}</div>
                      </button>
                    </td>
                    <td style={{ ...tdS }}>
                      <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, background: '#f1f5f9', color: D.text3, border: `1px solid ${D.border}` }}>
                        {e.post_type || '—'}
                      </span>
                    </td>
                    <td style={{ ...tdS }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {(e.languages || [e.language]).filter(Boolean).map(lg => (
                          <span key={lg} style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                            background: 'rgba(0,77,66,0.08)', color: D.brand, border: '1px solid rgba(0,77,66,0.18)',
                            textTransform: 'uppercase' }}>{lg}</span>
                        ))}
                      </div>
                    </td>
                    <td style={{ ...tdS }}>
                      <Badge text={e.api || 'unknown'} color={apiColor(e.api)} />
                    </td>
                    <td style={{ ...tdS, maxWidth: 180 }}>
                      <span style={{ fontSize: 12, color: D.text3, fontFamily: 'monospace', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {modelShort(e.model)}
                      </span>
                    </td>
                    <td style={{ ...tdS, textAlign: 'right', color: D.text3, fontWeight: 600 }}>{e.times_translated || 1}</td>
                    <td style={{ ...tdS, textAlign: 'right', fontWeight: 600 }}>{(e.fields_count || 0).toLocaleString()}</td>
                    <td style={{ ...tdS, textAlign: 'right' }}>
                      {e.tokens_used > 0
                        ? <span style={{ fontWeight: 600, color: D.text1 }}>{e.tokens_used.toLocaleString()}</span>
                        : <span style={{ color: D.text3 }}>—</span>
                      }
                    </td>
                    <td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                      {(() => {
                        const subEntries = (e.entries || []).length > 0 ? e.entries : [e];
                        let total = 0; let hasCost = false;
                        for (const s of subEntries) {
                          const sc = calcCost(s.model, s.input_tokens||0, s.output_tokens||0, pricing);
                          if (sc !== null) { total += sc; hasCost = true; }
                        }
                        return hasCost
                          ? <span style={{ color: '#059669', fontWeight: 600 }}>{fmtCost(total)}</span>
                          : <span style={{ color: D.text3, fontSize: 11 }}>legacy</span>;
                      })()}
                    </td>
                    {_isSuperAdmin && (
                      <td style={{ ...tdS }}>
                        <div style={{ fontWeight: 500, fontSize: 13, color: D.text1 }}>{e.user_name || '—'}</div>
                        {e.user_id && e.user_id !== e.user_name && (
                          <div style={{ fontSize: 11, color: D.text3, marginTop: 1 }}>{e.user_id.slice(0,12)}…</div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* - Pagination - */}
          {totalPages > 1 && (
            <div style={{ padding: '12px 16px', borderTop: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
              <span style={{ fontSize: 13, color: D.text3, marginRight: 8 }}>
                Page {page} of {totalPages}
              </span>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                style={{ height: 32, padding: '0 14px', borderRadius: 6, border: `1px solid ${D.border2}`,
                  background: page <= 1 ? '#f8fafc' : '#fff', color: page <= 1 ? D.text3 : D.text2,
                  fontSize: 13, cursor: page <= 1 ? 'default' : 'pointer' }}>← Prev</button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                const pg = totalPages <= 7 ? i + 1 : page <= 4 ? i + 1 : page >= totalPages - 3 ? totalPages - 6 + i : page - 3 + i;
                return (
                  <button key={pg} onClick={() => setPage(pg)}
                    style={{ height: 32, minWidth: 32, padding: '0 10px', borderRadius: 6,
                      border: `1px solid ${pg === page ? D.brand : D.border2}`,
                      background: pg === page ? D.brand : '#fff',
                      color: pg === page ? '#fff' : D.text2,
                      fontSize: 13, fontWeight: pg === page ? 700 : 400, cursor: 'pointer' }}>
                    {pg}
                  </button>
                );
              })}
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                style={{ height: 32, padding: '0 14px', borderRadius: 6, border: `1px solid ${D.border2}`,
                  background: page >= totalPages ? '#f8fafc' : '#fff', color: page >= totalPages ? D.text3 : D.text2,
                  fontSize: 13, cursor: page >= totalPages ? 'default' : 'pointer' }}>Next →</button>
            </div>
          )}
        </div>

      </div>
      {/* -- Page Stats Modal -- */}
      {pageModal && (
        <div onClick={() => { setPageModal(null); setPageUrls({}); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 780, maxHeight: '85vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>

            {/* Header */}
            <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${D.border}`, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: D.text1 }}>{pageModal.title}</div>

                </div>
                {pageStats && <div style={{ fontSize: 12, color: D.text3, marginTop: 3 }}>Post ID {pageModal.post_id} &middot; {pageStats.summary.post_type}</div>}
              </div>
              <button onClick={() => { setPageModal(null); setPageUrls({}); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: D.text3, lineHeight: 1, padding: '2px 4px', flexShrink: 0 }}>x</button>
            </div>

            <div style={{ padding: '20px 24px' }}>
              {statsLoad && <div style={{ textAlign: 'center', padding: 40, color: D.text3 }}>Loading stats...</div>}

              {!statsLoad && pageStats && (
                <>
                  {/* Summary cards */}
                  <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                    {[
                      { label: 'Times Translated', value: pageStats.summary.total_jobs },
                      { label: 'Fields Translated', value: pageStats.summary.total_fields.toLocaleString() },
                      { label: 'Tokens Used',       value: pageStats.summary.total_tokens > 0 ? pageStats.summary.total_tokens.toLocaleString() : '---' },
                      { label: 'Languages',         value: Object.keys(pageStats.summary.by_language).length },
                    ].map(s => (
                      <div key={s.label} style={{ flex: '1 1 130px', background: '#f8fafc', border: `1px solid ${D.border}`, borderRadius: 8, padding: '12px 16px' }}>
                        <div style={{ fontSize: 11, color: D.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{s.label}</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: D.text1 }}>{s.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Language breakdown pills */}
                  {Object.keys(pageStats.summary.by_language).length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: D.text3, marginBottom: 8 }}>LANGUAGES TRANSLATED</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {Object.entries(pageStats.summary.by_language).sort((a,b)=>b[1]-a[1]).map(([l,n]) => (
                          <span key={l} style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 4,
                            background: 'rgba(0,77,66,0.08)', color: D.brand, border: '1px solid rgba(0,77,66,0.2)' }}>
                            {l.toUpperCase()} &times; {n}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Jobs table */}
                  <div style={{ fontSize: 12, fontWeight: 600, color: D.text3, marginBottom: 8 }}>TRANSLATION HISTORY</div>
                  <div style={{ border: `1px solid ${D.border}`, borderRadius: 8, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc' }}>
                          {['Date','Language','API','Model','Fields','Tokens','Cost',_isSuperAdmin?'User':'','View'].filter(Boolean).map(h => (
                            <th key={h} style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600, color: D.text3, textAlign: h==='Fields'||h==='Tokens'||h==='Cost'?'right':'left', borderBottom: `1px solid ${D.border}`, whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pageStats.jobs.filter(j => (j.tokens_used||0) > 0).map((j,i) => {
                          const lg = (j.language||'').toLowerCase();
                          const viewUrl = pageUrls[lg] || pageUrls['default'] || pageModal.url || '';
                          return (
                          <tr key={j.id || i} style={{ background: i%2===0?'#fff':'#fafbfc' }}>
                            <td style={{ padding: '7px 12px', fontSize: 11, color: D.text3, whiteSpace: 'nowrap', borderBottom: `1px solid ${D.border}` }}>{fmt(j.timestamp)}</td>
                            <td style={{ padding: '7px 12px', fontWeight: 700, fontSize: 12, color: D.brand, textTransform: 'uppercase', borderBottom: `1px solid ${D.border}` }}>{j.language}</td>
                            <td style={{ padding: '7px 12px', borderBottom: `1px solid ${D.border}` }}>
                              <Badge text={j.api||'?'} color={apiColor(j.api)} />
                            </td>
                            <td style={{ padding: '7px 12px', fontSize: 11, color: D.text3, fontFamily: 'monospace', borderBottom: `1px solid ${D.border}` }}>{modelShort(j.model)}</td>
                            <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 600, fontSize: 12, borderBottom: `1px solid ${D.border}` }}>{(j.fields_count||0).toLocaleString()}</td>
                            <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: 12, borderBottom: `1px solid ${D.border}` }}>
                              <span style={{ fontWeight: 600, color: D.text1 }}>{j.tokens_used.toLocaleString()}</span>
                            </td>
                            <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: 11, fontFamily: 'monospace', borderBottom: `1px solid ${D.border}` }}>
                              {(() => { const cost = calcCost(j.model, j.input_tokens||0, j.output_tokens||0, pricing); return cost !== null
                                ? <span style={{ color: '#059669', fontWeight: 600 }}>{fmtCost(cost)}</span>
                                : <span style={{ color: D.text3 }}>—</span>; })()}
                            </td>
                            {_isSuperAdmin && <td style={{ padding: '7px 12px', fontSize: 12, color: D.text2, borderBottom: `1px solid ${D.border}` }}>{j.user_name||'---'}</td>}
                            <td style={{ padding: '7px 12px', borderBottom: `1px solid ${D.border}` }}>
                              {viewUrl ? (
                                <a href={viewUrl} target="_blank" rel="noreferrer" title={`View ${(j.language||'').toUpperCase()} page`}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: D.brand,
                                    textDecoration: 'none', background: 'rgba(0,77,66,0.07)', border: '1px solid rgba(0,77,66,0.2)',
                                    borderRadius: 4, padding: '2px 7px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                  <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                                  </svg>
                                  {(j.language||'').toUpperCase()}
                                </a>
                              ) : <span style={{ color: D.text3, fontSize: 11 }}>—</span>}
                            </td>
                          </tr>
                        );})}
                        {pageStats.jobs.filter(j => (j.tokens_used||0) > 0).length === 0 && (
                          <tr><td colSpan={_isSuperAdmin?9:8} style={{ padding: 24, textAlign: 'center', color: D.text3, fontSize: 13 }}>No translation records found</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {!statsLoad && !pageStats && (
                <div style={{ textAlign: 'center', padding: 40, color: D.text3 }}>Could not load stats</div>
              )}
            </div>
          </div>
        </div>
      )}

    </Shell>
  );
}
