'use client';
import { useState, useEffect, useCallback } from 'react';
import Shell, { D, Alert } from '../components/Shell';
import { FlagImg, useLanguages } from '../lib/useLanguages';
import { isAdmin, getAllowedPostTypes } from '../lib/perms';

interface LogEntry {
  id: string; timestamp: string; post_id: number; post_title: string;
  post_type: string; language: string; language_name: string;
  api: string; model: string; fields_count: number; tokens_used: number; status: string;
}

interface PostType { slug: string; label: string; count: number; }

const DownloadIcon = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1={12} y1={15} x2={12} y2={3}/>
  </svg>
);

const RefreshIcon = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
  </svg>
);

export default function ReportsPage() {
  const { languages } = useLanguages();
  // Decode JWT for identity and superadmin detection
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
  // For restricted users: start with their first assigned post type pre-selected
  const _userPostTypes: string[] = (!_isSuperAdmin && _jwtP?.permissions?.post_types) ? _jwtP.permissions.post_types : [];

  const [log, setLog]             = useState<LogEntry[]>([]);
  const [postTypes, setPostTypes] = useState<PostType[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [filterType, setFilterType]   = useState(_userPostTypes[0] || '');
  const [page, setPage]           = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal]         = useState(0);
  const [alert, setAlert]         = useState<{ text: string; ok: boolean } | null>(null);

  const [filterUserId,  setFilterUserId]  = useState('');
  const [userList,      setUserList]      = useState<{id: string; username: string}[]>([]);

  const PER_PAGE = 25;

  useEffect(() => {
    fetch('/api/post-types').then(r => r.json()).then((d: PostType[]) => {
      if (Array.isArray(d)) {
        if (!_isSuperAdmin) {
          const userPT: string[] = _jwtP?.permissions?.post_types || [];
          if (userPT.length > 0) { setPostTypes(d.filter(pt => userPT.includes(pt.slug))); return; }
        }
        setPostTypes(d);
      }
    }).catch(() => {});
    if (_isSuperAdmin) {
      fetch('/api/users', { headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('bt_token') || '') } })
        .then(r => r.json()).then((d: any[]) => {
          if (Array.isArray(d)) setUserList(d.filter((u: any) => u.role !== 'superadmin').map((u: any) => ({ id: u.id, username: u.username })));
        }).catch(() => {});
    }
  }, []);

  const fetchLog = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page), per_page: String(PER_PAGE),
        ...(search ? { search } : {}),
        ...(filterType ? { post_type: filterType } : {}),
      });
      const effectiveUid = _isSuperAdmin ? filterUserId : _userId;
      const d = await fetch(`/api/translation-log?user_id=${effectiveUid}&${params}`).then(r => r.json());
      setLog(Array.isArray(d.data) ? d.data : []);
      setTotalPages(d.total_pages || 1);
      setTotal(d.total || 0);
    } catch { setLog([]); }
    setLoading(false);
  }, [page, search, filterType, filterUserId]);

  useEffect(() => { fetchLog(); }, [fetchLog]);

  function handleSearch(e: React.FormEvent) { e.preventDefault(); setPage(1); setSearch(searchInput.trim()); }

  async function downloadCSV() {
    try {
      const effectiveUid = _isSuperAdmin ? filterUserId : _userId;
      const params = new URLSearchParams({
        ...(search ? { search } : {}),
        ...(filterType ? { post_type: filterType } : {}),
        ...(effectiveUid ? { user_id: effectiveUid } : {}),
      });
      const url = `/api/translation-log/download?${params}`;
      const a = document.createElement('a');
      a.href = url; a.download = 'translation-log.csv'; a.click();
    } catch { setAlert({ text: 'Download failed', ok: false }); }
  }

  function getLang(code: string) { return languages.find(l => l.code === code); }

  function formatDate(ts: string) {
    try { return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return ts; }
  }

  const thStyle: React.CSSProperties = {
    textAlign: 'left', padding: '10px 12px', fontSize: 12, fontWeight: 600,
    color: '#333', textTransform: 'capitalize', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', whiteSpace: 'nowrap',
  };
  const tdStyle: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'middle', color: '#333', fontSize: 13, borderBottom: '1px solid #e2e8f0' };

  return (
    <Shell>
      <Alert msg={alert} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={D.pageTitle}>Reports</h1>
          <p style={D.pageSub}>Translation log — every page translated, language, and field count.</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => { fetchLog(); }} style={D.btnSecondary}><RefreshIcon /> Refresh</button>
          <button onClick={downloadCSV} style={D.btnPrimary}><DownloadIcon /> Download CSV</button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ ...D.card, marginBottom: 16 }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="bt-input-focus" style={{ ...D.input, maxWidth: 280 }}
            placeholder="Search by page title..." value={searchInput} onChange={e => setSearchInput(e.target.value)} />
          <select className="bt-input-focus" style={{ ...D.select, width: 'auto', minWidth: 160 }}
            value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1); }}>
            <option value="">{_userPostTypes.length > 0 ? "All" : "All Post Types"}</option>
            {postTypes.map(pt => <option key={pt.slug} value={pt.slug}>{pt.label}</option>)}
          </select>
          {_isSuperAdmin && userList.length > 0 && (
            <select className="bt-input-focus" style={{ ...D.select, width: 'auto', minWidth: 150 }}
              value={filterUserId} onChange={e => { setFilterUserId(e.target.value); setPage(1); }}>
              <option value="">All Users</option>
              {userList.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
            </select>
          )}
          <button type="submit" style={D.btnSecondary}>Search</button>
          {(search || filterType || filterUserId) && (
            <button type="button" style={D.btnSecondary} onClick={() => { setSearchInput(''); setSearch(''); setFilterType(''); setFilterUserId(''); setPage(1); }}>Clear</button>
          )}
          {!loading && <span style={{ marginLeft: 'auto', fontSize: 12, color: D.text3 }}>{total.toLocaleString()} entries</span>}
        </form>
      </div>

      <div style={D.cardLg}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: D.text3, fontSize: 13 }}>Loading...</div>
        ) : log.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center' }}>
            <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth={1.5} strokeLinecap="round" style={{ margin: '0 auto 16px', display: 'block' }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
            <div style={{ fontSize: 15, fontWeight: '600', color: D.text2, marginBottom: 6 }}>No Translation Logs Found</div>
            <div style={{ fontSize: 13, color: D.text3 }}>{_isSuperAdmin ? 'No translations match the current filters.' : 'No translations found for your account yet. Run a translation to see your report here.'}</div>
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Page</th>
                    {_isSuperAdmin && <th style={thStyle}>User</th>}
                    <th style={thStyle}>Post Type</th>
                    <th style={thStyle}>Language</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Fields</th>
                    <th style={thStyle}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map(entry => {
                    const li = getLang(entry.language);
                    return (
                      <tr key={entry.id} className="bt-row">
                        <td style={{ ...tdStyle, maxWidth: 200 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180, fontWeight: '500', color: D.text1 }}>
                            {entry.post_title || '—'}
                          </div>
                          <div style={{ fontSize: 11, color: D.text3, fontFamily: 'monospace' }}>#{entry.post_id}</div>
                        </td>
                        {_isSuperAdmin && (
                          <td style={tdStyle}>
                            {(entry as any).user_name
                              ? <span style={{ display:'inline-flex',alignItems:'center',gap:4,fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:99,background:'#f3e8ff',color:'#7c3aed',border:'1px solid rgba(124,58,237,0.2)' }}>{(entry as any).user_name}</span>
                              : <span style={{ color: D.text3 }}>—</span>}
                          </td>
                        )}
                        <td style={tdStyle}>
                          <span style={{ fontSize: 11, padding: '2px 7px', background: '#f1f5f9', border: `1px solid ${D.border}`, borderRadius: 4, color: D.text2 }}>{entry.post_type}</span>
                        </td>
                        <td style={tdStyle}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {li ? <FlagImg flag={li.flag} size={14} /> : null}
                            <span style={{ fontSize: 12, fontWeight: '600', textTransform: 'uppercase' }}>{entry.language}</span>
                          </div>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {entry.fields_count}
                        </td>
                        <td style={{ ...tdStyle, fontSize: 11, color: D.text3, whiteSpace: 'nowrap' }}>
                          {formatDate(entry.timestamp)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingTop: 16, borderTop: `1px solid ${D.border}` }}>
                <button style={{ ...D.btnSecondary, opacity: page <= 1 ? 0.4 : 1 }} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Prev</button>
                <span style={{ fontSize: 12, color: D.text3 }}>Page {page} of {totalPages} ({total.toLocaleString()} total)</span>
                <button style={{ ...D.btnSecondary, opacity: page >= totalPages ? 0.4 : 1 }} onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</button>
              </div>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
