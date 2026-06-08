'use client';
import { getAllowedLangs, getAllowedPostTypes, getAllowedApi, getAllowedModels, defaultLang, defaultModel, filterAllowed, isAdmin, isApiAllowed, getAllowedModelsForApi } from '../lib/perms';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import Shell, { D, Alert } from '../components/Shell';
import PromptBox from '../components/PromptBox';
import { ModelSelect } from '../lib/useModels';
import { FlagImg, useLanguages } from '../lib/useLanguages';
import { addJob } from '../components/JobsMonitor';

interface Page {
  id: number; post_id: number; post_type: string;
  title: string; slug: string; url: string;
  modified: string; translated_languages: string[];
  status: 'complete' | 'partial' | 'not_started';
}
interface PostType { slug: string; label: string; count: number; }
interface CfgModal { pageId: number; title: string; api: string; model: string; loading: boolean; }
interface TranslateModal { page: Page; selectedLangs: string[]; step: 1|2; prompts: Record<string,string>; running: boolean; }

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  complete:    { background: 'rgba(16,185,129,0.1)',  color: '#059669', border: '1px solid rgba(16,185,129,0.25)' },
  partial:     { background: 'rgba(245,158,11,0.1)', color: '#d97706', border: '1px solid rgba(245,158,11,0.25)' },
  not_started: { background: '#f8fafc',               color: '#94a3b8', border: '1px solid #e2e8f0' },
};
const STATUS_LABEL: Record<string, string> = { complete: 'Complete', partial: 'Partial', not_started: 'Not Started' };
const PER_PAGE = 25;

function FunnelIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
    </svg>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px', fontSize: 12, fontWeight: 600,
  color: '#333333', textTransform: 'capitalize', letterSpacing: 0,
  borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap', background: '#f8fafc',
};
const tdStyle: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'middle', color: '#333333', fontSize: 13 };

export default function PagesPage() {
  const { languages } = useLanguages();
  const [pages, setPages]               = useState<Page[]>([]);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState('');
  const [searchInput, setSearchInput]   = useState('');
  const [page, setPage]                 = useState(1);
  const [totalPages, setTotalPages]     = useState(1);
  const [total, setTotal]               = useState(0);
  const [postTypes, setPostTypes]       = useState<PostType[]>([]);
  const [filterOpen, setFilterOpen]     = useState(false);
  const [activeTypes, setActiveTypes]   = useState<string[]>(() => getAllowedPostTypes());
  const [pendingTypes, setPendingTypes] = useState<string[]>(() => getAllowedPostTypes());
  const [hideTranslated, setHideTranslated] = useState(false);
  const [selected, setSelected]         = useState<Set<number>>(new Set());
  const [bulkLang, setBulkLang]         = useState(() => defaultLang());
  const [bulkRunning, setBulkRunning]   = useState(false);
  const [alert, setAlert]               = useState<{ text: string; ok: boolean } | null>(null);
  const [cfgModal, setCfgModal]         = useState<CfgModal | null>(null);
  const [cfgSaving, setCfgSaving]       = useState(false);
  const [trModal, setTrModal]           = useState<TranslateModal | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  function showAlert(t: string, ok: boolean) { setAlert({ text: t, ok }); setTimeout(() => setAlert(null), 5000); }

  useEffect(() => {
    fetch('/api/post-types').then(r => r.json()).then((d: PostType[]) => {
      if (Array.isArray(d)) setPostTypes(d);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
    }
    if (filterOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [filterOpen]);

  const fetchPages = useCallback(async () => {
    setLoading(true); setSelected(new Set());
    try {
      // Get effective types: intersection of user selection + allowed types
      const _allowed = getAllowedPostTypes();
      const _effective = _allowed.length
        ? (activeTypes.length ? activeTypes.filter(t => _allowed.includes(t)) : _allowed)
        : activeTypes;
      if (_effective.length > 1) {
        const results = await Promise.all(
          _effective.map(t => {
            const params = new URLSearchParams({
              page: '1', per_page: '50',
              ...(search ? { search } : {}),
              post_type: t,
            });
            return fetch(`/api/pages?${params}`).then(r => r.json());
          })
        );
        const merged: Page[] = [];
        const seen = new Set<number>();
        for (const r of results) {
          for (const p of (r.data || [])) {
            if (!seen.has(p.id)) { seen.add(p.id); merged.push(p); }
          }
        }
        merged.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
        setPages(merged);
        setTotalPages(1);
        setTotal(results.reduce((s, r) => s + (r.total || 0), 0));
      } else {
        // ALWAYS enforce allowed post types - no bypass possible
        const _apt = getAllowedPostTypes();
        const _eff = _apt.length
          ? (activeTypes.length ? activeTypes.filter((t: string) => _apt.includes(t)) : _apt)
          : (activeTypes.length === 1 ? [activeTypes[0]] : []);
        const _po: Record<string,string> = { page: String(page), per_page: String(PER_PAGE) };
        if (search) _po.search = search;
        if (_eff.length === 1) _po.post_type = _eff[0];
        const params = new URLSearchParams(_po);
        const json = await fetch(`/api/pages?${params}`).then(r => r.json());
        setPages(json.data || []);
        setTotalPages(json.total_pages || 1);
        setTotal(json.total || 0);
      }
    } catch { showAlert('Error loading pages', false); }
    setLoading(false);
  }, [page, search, activeTypes]);

  useEffect(() => { fetchPages(); }, [fetchPages]);

  const displayPages = hideTranslated ? pages.filter(p => p.status !== 'complete') : pages;

  function handleSearchSubmit(e: React.FormEvent) { e.preventDefault(); setPage(1); setSearch(searchInput.trim()); }
  function toggleSelect(id: number) { setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function toggleAll() { setSelected(selected.size === displayPages.length ? new Set() : new Set(displayPages.map(p => p.id))); }

  function openFilter() { setPendingTypes([...activeTypes]); setFilterOpen(true); }
  function applyFilter() { const a=getAllowedPostTypes(); const filtered=a.length?pendingTypes.filter(t=>a.includes(t)):pendingTypes; setActiveTypes(filtered.length?filtered:[...a]); setPage(1); setFilterOpen(false); }
  function clearFilter() { const a=getAllowedPostTypes(); setPendingTypes([...a]); setActiveTypes([...a]); setPage(1); setFilterOpen(false); }
  function removeType(slug: string) { const a=getAllowedPostTypes(); setActiveTypes(t => { const n=t.filter(x=>x!==slug); return n.length>0?n:[...a]; }); setPage(1); }

  async function quickTranslate() {
    if (!trModal || !trModal.selectedLangs.length) return;
    setTrModal(m => m ? { ...m, running: true } : null);
    let done = 0;
    for (const lang of trModal.selectedLangs) {
      try {
        const data = await fetch('/api/translate/page/async', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('bt_token') || '') },
          body: JSON.stringify({ page_id: trModal.page.post_id, language: lang, ...(trModal.prompts[lang] ? {prompts:{[lang]:trModal.prompts[lang]}} : {}) }),
        }).then(r => r.json());
        if (data.job_id) { addJob({ job_id: data.job_id, lang, page_id: trModal.page.post_id, page_title: trModal.page.title }); done++; }
      } catch {}
    }
    setTrModal(null);
    showAlert(`Started ${done} translation job${done !== 1 ? 's' : ''} — watch monitor`, true);
  }

  async function bulkTranslate() {
    if (!selected.size) return;
    setBulkRunning(true);
    const sel = pages.filter(p => selected.has(p.id));
    let done = 0;
    for (const p of sel) {
      try {
        const data = await fetch('/api/translate/page/async', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('bt_token') || '') },
          body: JSON.stringify({ page_id: p.post_id, language: bulkLang }),
        }).then(r => r.json());
        if (data.job_id) { addJob({ job_id: data.job_id, lang: bulkLang, page_id: p.post_id, page_title: p.title }); done++; }
      } catch {}
    }
    setBulkRunning(false); setSelected(new Set());
    showAlert(`Started ${done} translation job${done !== 1 ? 's' : ''}`, true);
  }

  async function openCfgModal(p: Page) {
    setCfgModal({ pageId: p.id, title: p.title, api: '', model: '', loading: true });
    try {
      const cfg = await fetch(`/api/translate/page/${p.id}/config`).then(r => r.json());
      setCfgModal(m => {
        if (!m) return null;
        const allowedApi = getAllowedApi();
        const userIsRestricted = !isAdmin() && allowedApi !== 'all';
        const api = cfg.api || (userIsRestricted ? (allowedApi === 'both' ? 'deepseek' : allowedApi) : '');
        const resolvedApi = (api || 'deepseek') as 'deepseek' | 'openrouter';
        const allowedMods = !isAdmin() ? getAllowedModelsForApi(resolvedApi) : [];
        const model = cfg.model || (allowedMods.length ? allowedMods[0] : '');
        return { ...m, api, model, loading: false };
      });
    } catch { showAlert('Error loading config', false); setCfgModal(null); }
  }

  async function saveCfg(e: React.FormEvent) {
    e.preventDefault(); if (!cfgModal) return; setCfgSaving(true);
    try {
      const res = await fetch(`/api/translate/page/${cfgModal.pageId}/config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api: cfgModal.api, model: cfgModal.model }),
      });
      if (!res.ok) throw new Error('Failed');
      showAlert('AI config saved.', true); setCfgModal(null);
    } catch { showAlert('Error saving config', false); }
    setCfgSaving(false);
  }

  function getLang(code: string) { return languages.find(l => l.code === code); }

  return (
    <Shell>
      <Alert msg={alert} />
      <div style={{ marginBottom: 16 }}>
        <h1 style={D.pageTitle}>Pages</h1>
        <p style={D.pageSub}>Browse all site pages, filter by type, and manage translations.</p>
      </div>

      <div style={{ ...D.card, marginBottom: 14 }}>
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="bt-input-focus" style={{ ...D.input, maxWidth: 300 }}
            placeholder="Search pages..." value={searchInput} onChange={e => setSearchInput(e.target.value)} />
          <button type="submit" className="bt-btn-secondary" style={D.btnSecondary}>Search</button>
          {search && (
            <button type="button" className="bt-btn-secondary" style={D.btnSecondary}
              onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}>Clear</button>
          )}
          <div ref={filterRef} style={{ position: 'relative' }}>
            <button type="button" onClick={openFilter} style={{
              ...D.btnSecondary,
              background: activeTypes.length > 0 ? 'rgba(0,77,66,0.08)' : '#fff',
              color: activeTypes.length > 0 ? D.brand : D.text2,
              borderColor: activeTypes.length > 0 ? D.brand : '#d1d9e0',
            }}>
              <FunnelIcon /> Filter {activeTypes.length > 0 ? `(${activeTypes.length})` : ''}
            </button>
            {filterOpen && (
              <div style={{
                position: 'absolute', top: '110%', left: 0, zIndex: 100,
                background: '#fff', border: `1px solid ${D.border}`, borderRadius: 8,
                boxShadow: '0 8px 30px rgba(0,0,0,0.12)', minWidth: 240, padding: 14,
              }}>
                <div style={{ fontSize: 12, fontWeight: '600', color: '#333', marginBottom: 10 }}>Post Types</div>
                <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                  {postTypes.filter(pt => {
                    const allowed = getAllowedPostTypes();
                    return !allowed.length || allowed.includes(pt.slug);
                  }).map(pt => (
                    <label key={pt.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', cursor: 'pointer', borderRadius: 4 }}>
                      <input type="checkbox" checked={pendingTypes.includes(pt.slug)}
                        onChange={() => setPendingTypes(prev =>
                          prev.includes(pt.slug) ? prev.filter(x => x !== pt.slug) : [...prev, pt.slug]
                        )}
                        style={{ accentColor: D.brand }} />
                      <span style={{ fontSize: 13, color: '#111', flex: 1 }}>{pt.label}</span>
                      <span style={{ fontSize: 11, color: '#666' }}>({pt.count.toLocaleString()})</span>
                    </label>
                  ))}
                  {postTypes.length === 0 && <div style={{ fontSize: 12, color: '#666', padding: '4px 0' }}>No types loaded</div>}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${D.border}` }}>
                  <button type="button" onClick={applyFilter} style={{ ...D.btnPrimary, fontSize: 12, padding: '7px 16px', flex: 1, justifyContent: 'center' }}>Apply</button>
                  <button type="button" onClick={clearFilter} style={{ ...D.btnSecondary, fontSize: 12, padding: '7px 16px' }}>Clear</button>
                </div>
              </div>
            )}
          </div>

          {/* Hide Translated toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', marginLeft: 'auto', userSelect: 'none' }}>
            <div style={{ position: 'relative', width: 34, height: 18 }}>
              <input type="checkbox" checked={hideTranslated} onChange={e => setHideTranslated(e.target.checked)}
                style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }} />
              <div style={{
                position: 'absolute', inset: 0, borderRadius: 99, cursor: 'pointer',
                background: hideTranslated ? D.brand : '#d1d9e0',
                transition: 'background 0.2s',
              }}>
                <div style={{
                  position: 'absolute', top: 2, left: hideTranslated ? 18 : 2, width: 14, height: 14,
                  borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }} />
              </div>
            </div>
            <span style={{ fontSize: 12, color: D.text2, whiteSpace: 'nowrap' }}>Hide Translated</span>
          </label>

          {!loading && <span style={{ fontSize: 12, color: D.text3 }}>{total.toLocaleString()} pages</span>}
        </form>

        {activeTypes.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: D.text3 }}>Filtered:</span>
            {activeTypes.map(slug => {
              const pt = postTypes.find(x => x.slug === slug);
              return (
                <span key={slug} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '3px 8px', borderRadius: 4, background: 'rgba(0,77,66,0.08)', border: `1px solid rgba(0,77,66,0.2)`, color: D.brand }}>
                  {pt?.label || slug}
                  <button onClick={() => removeType(slug)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: D.text3, padding: 0, fontSize: 13, lineHeight: 1 }}>x</button>
                </span>
              );
            })}
          </div>
        )}

        {selected.size > 0 && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: '600', color: D.brand }}>{selected.size} selected</span>
            <select value={bulkLang} onChange={e => setBulkLang(e.target.value)} style={{ ...D.select, width: 'auto' }}>
              {languages.filter(l=>{const a=getAllowedLangs();return !a.length||a.includes(l.code);}).map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
            <button onClick={bulkTranslate} disabled={bulkRunning} className="bt-btn-primary" style={{ ...D.btnPrimary, opacity: bulkRunning ? 0.6 : 1 }}>
              {bulkRunning ? 'Starting...' : `Bulk Translate (${selected.size})`}
            </button>
            <button onClick={() => setSelected(new Set())} className="bt-btn-secondary" style={D.btnSecondary}>Deselect All</button>
          </div>
        )}
      </div>

      <div style={D.cardLg}>
        {loading ? (
          <p style={{ color: D.text2, fontSize: 13, padding: '20px 0' }}>Loading pages...</p>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 40 }}>
                    <input type="checkbox" checked={displayPages.length > 0 && selected.size === displayPages.length} onChange={toggleAll} style={{ cursor: 'pointer', accentColor: D.brand }} />
                  </th>
                  <th style={thStyle}>Title</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Id</th>
                  <th style={thStyle}>Translated</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayPages.length === 0 && (
                  <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', padding: '32px', color: D.text3 }}>
                    {hideTranslated && pages.length > 0 ? 'All pages on this page are translated.' : 'No pages found.'}
                  </td></tr>
                )}
                {displayPages.map(p => (
                  <tr key={p.id} className="bt-row" style={{ borderBottom: `1px solid ${D.border}`, background: selected.has(p.id) ? 'rgba(0,77,66,0.04)' : '#fff', transition: 'background 0.1s' }}>
                    <td style={{ ...tdStyle, width: 40 }}>
                      <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} style={{ cursor: 'pointer', accentColor: D.brand }} />
                    </td>
                    <td style={{ ...tdStyle, maxWidth: 260 }}>
                      <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', color: D.text1, fontWeight: '500', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>
                        {p.title || <span style={{ color: D.text3 }}>(No Title)</span>}
                      </a>
                      <span style={{ display: 'block', fontSize: 11, color: D.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240, marginTop: 2 }}>/{p.slug}</span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: 11, padding: '2px 7px', background: '#f1f5f9', border: `1px solid ${D.border}`, borderRadius: 4, color: D.text2 }}>{p.post_type}</span>
                    </td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', color: D.text3, fontSize: 12 }}>{p.post_id}</td>
                    <td style={{ ...tdStyle, maxWidth: 180 }}>
                      {p.translated_languages?.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                          {p.translated_languages.map(code => {
                            const li = getLang(code);
                            return (
                              <span key={code} title={li?.name || code} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, padding: '1px 5px', background: 'rgba(0,77,66,0.07)', border: '1px solid rgba(0,77,66,0.15)', borderRadius: 3, color: D.brand }}>
                                {li ? <FlagImg flag={li.flag} size={11} /> : null} {code}
                              </span>
                            );
                          })}
                        </div>
                      ) : <span style={{ color: D.text3, fontSize: 12 }}>None</span>}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ ...(STATUS_STYLE[p.status] || STATUS_STYLE.not_started), fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4, display: 'inline-block', whiteSpace: 'nowrap' }}>
                        {STATUS_LABEL[p.status] || 'Unknown'}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setTrModal({ page: p, selectedLangs: [], step: 1, prompts: {}, running: false })}
                          style={{ ...D.btnPrimary, fontSize: 12, padding: '5px 12px' }}>Translate</button>
                        <button onClick={() => openCfgModal(p)}
                          style={{ ...D.btnSecondary, fontSize: 12, padding: '5px 12px' }}>AI Config</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingTop: 16, borderTop: `1px solid ${D.border}` }}>
                <button className="bt-btn-secondary" style={{ ...D.btnSecondary, opacity: page <= 1 ? 0.4 : 1 }} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Prev</button>
                <span style={{ fontSize: 12, color: D.text3 }}>Page {page} of {totalPages}</span>
                <button className="bt-btn-secondary" style={{ ...D.btnSecondary, opacity: page >= totalPages ? 0.4 : 1 }} onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Translate Modal */}
      {trModal && (
        <div className="bt-overlay" onClick={e => { if (e.target === e.currentTarget && !trModal.running) setTrModal(null); }}>
          <div className="bt-modal" style={{ maxWidth: 540, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            {/* Header with step indicator */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div>
                <h2 style={{ margin: '0 0 2px', fontSize: 16, fontWeight: 700, color: D.text1 }}>
                  {trModal.step === 1 ? 'Select Languages' : 'Prompt Settings'}
                </h2>
                <p style={{ margin: 0, fontSize: 12, color: D.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trModal.page.title}</p>
              </div>
              <div style={{ display: 'flex', gap: 5 }}>
                {[1,2].map(s => (
                  <div key={s} style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, background: trModal.step === s ? D.brand : trModal.step > s ? '#10b981' : '#e2e8f0', color: trModal.step >= s ? '#fff' : '#94a3b8' }}>
                    {trModal.step > s ? '✓' : s}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ height: 1, background: '#e9eef3', margin: '10px 0' }} />

            {/* Scrollable content */}
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              {trModal.step === 1 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <label style={{ ...D.label, marginBottom: 0 }}>{trModal.selectedLangs.length} selected</label>
                    <button onClick={() => setTrModal(m => m ? { ...m, selectedLangs: languages.map(l => l.code) } : null)}
                      style={{ fontSize: 11, color: D.brand, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>All</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    {languages.filter(l => {
                    const allowed = getAllowedLangs();
                    return !allowed.length || allowed.includes(l.code);
                  }).map(l => {
                      const checked = trModal.selectedLangs.includes(l.code);
                      const done = trModal.page.translated_languages?.includes(l.code);
                      return (
                        <label key={l.code} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 6, border: `1.5px solid ${checked ? D.brand : D.border}`, background: checked ? 'rgba(0,77,66,0.05)' : '#fff', cursor: 'pointer' }}>
                          <input type="checkbox" checked={checked}
                            onChange={() => setTrModal(m => m ? { ...m, selectedLangs: checked ? m.selectedLangs.filter(c => c !== l.code) : [...m.selectedLangs, l.code] } : null)}
                            style={{ accentColor: D.brand }} />
                          <FlagImg flag={l.flag} size={14} />
                          <span style={{ fontSize: 13, color: D.text1, flex: 1 }}>{l.name}</span>
                          {done && <span style={{ fontSize: 10, fontWeight: 700, color: '#10b981' }}>✓</span>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {trModal.step === 2 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <p style={{ margin: '0 0 4px', fontSize: 12, color: '#64748b' }}>
                    Optionally set a custom prompt per language. Leave blank to use the default.
                  </p>
                  {trModal.selectedLangs.map(code => {
                    const l = languages.find(x => x.code === code);
                    return (
                      <div key={code} style={{ border: `1px solid ${trModal.prompts[code] ? D.brand : '#e2e8f0'}`, borderRadius: 8, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#f8fafc' }}>
                          <FlagImg flag={l?.flag} size={15} />
                          <span style={{ fontWeight: 600, fontSize: 13, color: D.text1, flex: 1 }}>{l?.name || code}</span>
                          {trModal.prompts[code] && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: 'rgba(0,77,66,0.1)', color: D.brand }}>Custom</span>}
                        </div>
                        <div style={{ padding: 10 }}>
                          <PromptBox
                            value={trModal.prompts[code] || ''}
                            onChange={v => setTrModal(m => m ? { ...m, prompts: { ...m.prompts, [code]: v } } : null)}
                            rows={4}
                            autoLoadDefault={true}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ height: 1, background: '#e9eef3', margin: '12px 0 10px' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button style={D.btnSecondary} onClick={() => { if (trModal.step === 1) setTrModal(null); else setTrModal(m => m ? { ...m, step: 1 } : null); }} disabled={trModal.running}>
                {trModal.step === 1 ? 'Cancel' : '← Back'}
              </button>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>{trModal.selectedLangs.length} language{trModal.selectedLangs.length !== 1 ? 's' : ''}</span>
                {trModal.step === 1 ? (
                  <button style={{ ...D.btnPrimary, opacity: !trModal.selectedLangs.length ? 0.4 : 1 }}
                    disabled={!trModal.selectedLangs.length}
                    onClick={() => setTrModal(m => m ? { ...m, step: 2 } : null)}>
                    Next: Prompts →
                  </button>
                ) : (
                  <button style={{ ...D.btnPrimary, opacity: trModal.running ? 0.5 : 1 }}
                    onClick={quickTranslate} disabled={trModal.running}>
                    {trModal.running ? 'Starting…' : 'Start Translation'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Config Modal */}
      {cfgModal && (
        <div className="bt-overlay" onClick={e => { if (e.target === e.currentTarget) setCfgModal(null); }}>
          <div className="bt-modal">
            <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: D.text1 }}>AI Config</h2>
            <p style={{ margin: '0 0 20px', fontSize: 12, color: D.text2 }}>{cfgModal.title}</p>
            {cfgModal.loading ? <p style={{ color: D.text2 }}>Loading...</p> : (
              <form onSubmit={saveCfg}>
                <div style={{ marginBottom: 14 }}>
                  <label style={D.label}>API Engine</label>
                  <select className="bt-input-focus" style={{ ...D.select, width: '100%' }}
                    value={cfgModal.api} onChange={e => setCfgModal(m => m ? { ...m, api: e.target.value, model: '' } : null)}>
                    {isAdmin() ? (
                      <>
                        <option value="">Default (Global)</option>
                        <option value="deepseek">DeepSeek</option>
                        <option value="openrouter">OpenRouter</option>
                      </>
                    ) : (
                      <>
                        {getAllowedApi()==='all' && <option value="">Default (Global)</option>}
                        {isApiAllowed('deepseek') && <option value="deepseek">DeepSeek</option>}
                        {isApiAllowed('openrouter') && <option value="openrouter">OpenRouter</option>}
                      </>
                    )}
                  </select>
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label style={D.label}>Model</label>
                  {isAdmin()
                    ? <ModelSelect api={cfgModal.api || 'deepseek'} value={cfgModal.model} includeDefault={true}
                        onChange={model => setCfgModal(m => m ? { ...m, model } : null)} style={{ ...D.select, width: '100%' }} />
                    : <select value={cfgModal.model} onChange={e=>setCfgModal(m=>m?{...m,model:e.target.value}:null)} style={{...D.select,width:'100%'}}>
                        {(()=>{
                          const api=(cfgModal.api||'deepseek') as 'deepseek'|'openrouter';
                          const allowed=getAllowedModelsForApi(api);
                          const dsAll=[{id:'deepseek-chat',name:'DeepSeek Chat (V3)'},{id:'deepseek-reasoner',name:'DeepSeek Reasoner (R1)'}];
                          const orFallback=['openai/gpt-4o-mini','openai/gpt-5-mini','openai/gpt-5','anthropic/claude-3.5-sonnet'];
                          const list=api==='deepseek'
                            ?(allowed.length?dsAll.filter(m=>allowed.includes(m.id)):dsAll).map(m=>({id:m.id,label:m.name}))
                            :(allowed.length?allowed:orFallback).map(id=>({id,label:id}));
                          const showDef=allowed.length===0;
                          return [...(showDef?[<option key="" value="">Default</option>]:[]),...list.map(m=><option key={m.id} value={m.id}>{m.label}</option>)];
                        })()}
                      </select>
                  }
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button type="button" className="bt-btn-secondary" style={D.btnSecondary} onClick={() => setCfgModal(null)}>Cancel</button>
                  <button type="submit" className="bt-btn-primary" style={{ ...D.btnPrimary, opacity: cfgSaving ? 0.6 : 1 }} disabled={cfgSaving}>
                    {cfgSaving ? 'Saving...' : 'Save Config'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
