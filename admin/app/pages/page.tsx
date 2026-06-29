'use client';
import { getAllowedLangs, getAllowedPostTypes, getAllowedPostTypesForSite, getActiveSite, getAllowedApi, getAllowedModels, defaultLang, defaultModel, filterAllowed, isAdmin, isApiAllowed, getAllowedModelsForApi } from '../lib/perms';
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
interface CfgModal { pageId: number; title: string; api: string; model: string; globalApi: string; globalModel: string; loading: boolean; }
interface TranslateModal { page: Page; selectedLangs: string[]; step: 1|2; prompts: Record<string,string>; forceMap: Record<string,boolean>; modelMap: Record<string,{api:string,model:string}>; running: boolean; }
interface LangHistory { timestamp: string; user_name: string; api: string; model: string; fields_count: number; tokens_used: number; }
interface LangReport  { language: string; language_name: string; count: number; history: LangHistory[]; }
interface PageReport  { post_id: number; page_title: string; total_translations: number; languages: LangReport[]; }

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
  const [activeSite, setActiveSite]     = useState<string>(() => typeof window !== 'undefined' ? getActiveSite() : '');
  const [activeTypes, setActiveTypes]   = useState<string[]>(() => getAllowedPostTypesForSite(typeof window !== 'undefined' ? getActiveSite() : ''));
  const [pendingTypes, setPendingTypes] = useState<string[]>(() => getAllowedPostTypesForSite(typeof window !== 'undefined' ? getActiveSite() : ''));
  const [hideTranslated, setHideTranslated] = useState(false);
  const [selected, setSelected]         = useState<Set<number>>(new Set());
  const [bulkLang, setBulkLang]         = useState(() => defaultLang());
  const [bulkRunning, setBulkRunning]   = useState(false);
  const [alert, setAlert]               = useState<{ text: string; ok: boolean } | null>(null);
  const [cfgModal, setCfgModal]         = useState<CfgModal | null>(null);
  const [urlModal,  setUrlModal]         = useState<Page | null>(null);
  const [cfgSaving, setCfgSaving]       = useState(false);
  const [trModal, setTrModal]           = useState<TranslateModal | null>(null);
  const [globalPrompt, setGlobalPrompt] = useState('');
  const [langPromptMap, setLangPromptMap] = useState<Record<string,string>>({});
  const [globalApiModel, setGlobalApiModel] = useState<{api:string,model:string}>({api:'deepseek',model:''});
  const [langApiCfgs, setLangApiCfgs] = useState<Record<string,{api:string,model:string}>>({});
  const [pageApiCfg, setPageApiCfg] = useState<{api:string,model:string,langModels:Record<string,{api:string,model:string}>}>({api:'',model:'',langModels:{}});
  const [reportModal, setReportModal]   = useState<{ page: Page; data: PageReport | null; loading: boolean } | null>(null);
  const [expandedLang, setExpandedLang] = useState<string | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  function showAlert(t: string, ok: boolean) { setAlert({ text: t, ok }); setTimeout(() => setAlert(null), 5000); }

  // Listen for personal site switch (regular users) and refresh
  useEffect(() => {
    function onSiteChanged(e: Event) {
      const newSite = (e as CustomEvent).detail as string;
      setActiveSite(newSite);
      const newTypes = getAllowedPostTypesForSite(newSite);
      setActiveTypes(newTypes);
      setPendingTypes(newTypes);
      setPage(1);
    }
    window.addEventListener('bt_site_changed', onSiteChanged);
    return () => window.removeEventListener('bt_site_changed', onSiteChanged);
  }, []);

  useEffect(() => {
    const qs = activeSite ? `?env=${encodeURIComponent(activeSite)}` : '';
    const token = typeof window !== 'undefined' ? localStorage.getItem('bt_token') : null;
    const headers: HeadersInit = token ? { Authorization: 'Bearer ' + token } : {};
    fetch(`/api/post-types${qs}`, { headers }).then(r => r.json()).then((d: PostType[]) => {
      if (Array.isArray(d)) setPostTypes(d);
    }).catch(() => {});
  }, [activeSite]);

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
      const _allowed = getAllowedPostTypesForSite(activeSite);
      const token = typeof window !== 'undefined' ? localStorage.getItem('bt_token') : null;
      const authHeaders: HeadersInit = token ? { Authorization: 'Bearer ' + token } : {};
      const envQs = activeSite ? `&env=${encodeURIComponent(activeSite)}` : '';

      if (search) {
        // ── SEARCH MODE ──
        let merged: Page[] = [];

        if (search === '__front_page__') {
          const json = await fetch(`/api/pages/front-page?_=1${envQs}`, { headers: authHeaders }).then(r => r.json());
          merged = json.data || [];
        } else if (search.startsWith('__url__:')) {
          const rawUrl = search.slice('__url__:'.length);
          const json2  = await fetch(`/api/pages/search-by-url?url=${encodeURIComponent(rawUrl)}${envQs}`, { headers: authHeaders }).then(r => r.json());
          merged = json2.data || [];
        } else {
          let results: any[];
          if (_allowed.length === 0) {
            const json = await fetch(`/api/pages?${new URLSearchParams({ page: '1', per_page: '200', search, post_type: 'all' })}${envQs}`, { headers: authHeaders }).then(r => r.json());
            results = [json];
          } else {
            results = await Promise.all(
              _allowed.map(t => fetch(`/api/pages?${new URLSearchParams({ page: '1', per_page: '100', search, post_type: t })}${envQs}`, { headers: authHeaders }).then(r => r.json()))
            );
          }
          const seen = new Set<number>();
          for (const r of results) {
            for (const p of (r.data || [])) {
              if (!seen.has(p.id)) { seen.add(p.id); merged.push(p); }
            }
          }
          const q = search.toLowerCase();
          merged.sort((a, b) => relevanceScore(b, q) - relevanceScore(a, q));
        }
        const _totalCount = merged.length;
        const _totalPgs   = Math.max(1, Math.ceil(_totalCount / PER_PAGE));
        const _sliced     = merged.slice((page - 1) * PER_PAGE, page * PER_PAGE);
        setPages(_sliced);
        setTotalPages(_totalPgs);
        setTotal(_totalCount);
      } else {
        // ── BROWSE MODE: use active type filters with pagination ──
        const _effective = _allowed.length
          ? (activeTypes.length ? activeTypes.filter(t => _allowed.includes(t)) : _allowed)
          : activeTypes;
        if (_effective.length > 1) {
          // Fetch all pages for each type (up to 500 each) then paginate client-side
          const results = await Promise.all(
            _effective.map(t => fetch(`/api/pages?${new URLSearchParams({ page: '1', per_page: '500', post_type: t })}${envQs}`, { headers: authHeaders }).then(r => r.json()))
          );
          const allMerged: Page[] = [];
          const seen = new Set<number>();
          for (const r of results) {
            for (const p of (r.data || [])) {
              if (!seen.has(p.id)) { seen.add(p.id); allMerged.push(p); }
            }
          }
          allMerged.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
          const totalCount = allMerged.length;
          const totalPgs = Math.max(1, Math.ceil(totalCount / PER_PAGE));
          const sliced = allMerged.slice((page - 1) * PER_PAGE, page * PER_PAGE);
          setPages(sliced); setTotalPages(totalPgs);
          setTotal(totalCount);
        } else {
          const _eff = _allowed.length
            ? (activeTypes.length ? activeTypes.filter((t: string) => _allowed.includes(t)) : _allowed)
            : (activeTypes.length === 1 ? [activeTypes[0]] : []);
          const _po: Record<string,string> = { page: String(page), per_page: String(PER_PAGE) };
          if (_eff.length === 1) _po.post_type = _eff[0];
          const json = await fetch(`/api/pages?${new URLSearchParams(_po)}${envQs}`, { headers: authHeaders }).then(r => r.json());
          setPages(json.data || []); setTotalPages(json.total_pages || 1); setTotal(json.total || 0);
        }
      }
    } catch { showAlert('Error loading pages', false); }
    setLoading(false);
  }, [page, search, activeTypes, activeSite]);

  useEffect(() => { fetchPages(); }, [fetchPages]);

  // Load global + language prompts for pre-filling translate modal
  useEffect(() => {
    fetch('/api/settings/global').then(r => r.json()).then(d => { setGlobalPrompt(d.prompt || ''); const gApi = d.api||'deepseek'; const gDefMdl = gApi === 'openrouter' ? 'openai/gpt-4o-mini' : 'deepseek-chat'; setGlobalApiModel({api: gApi, model: d.model||gDefMdl}); }).catch(() => {});
    fetch('/api/languages/config').then(r => r.json()).then((d: any[]) => {
      const pmap: Record<string,string> = {};
      const amap: Record<string,{api:string,model:string}> = {};
      (d || []).forEach((l: any) => {
        if (l.prompt) pmap[l.code] = l.prompt;
        if (l.api || l.model) { const la = l.api||'deepseek'; amap[l.code] = {api: la, model: l.model||(la==='openrouter'?'openai/gpt-4o-mini':'deepseek-chat')}; }
      });
      setLangPromptMap(pmap);
      setLangApiCfgs(amap);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!trModal) return;
    const postId = trModal.page.post_id;
    fetch(`/api/translate/page/${postId}/config`, {
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('bt_token') || '') }
    })
      .then(r => r.json())
      .then(d => {
        if (d.prompts && Object.keys(d.prompts).length > 0) {
          setTrModal(m => m ? { ...m, prompts: { ...d.prompts, ...m.prompts } } : null);
        }
        setPageApiCfg({ api: d.api||'', model: d.model||'', langModels: d.langModels||{} });
      })
      .catch(() => {});
  }, [trModal?.page?.post_id]);

  const displayPages = hideTranslated ? pages.filter(p => p.status !== 'complete') : pages;

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const raw = searchInput.trim();
    if (!raw) { setSearch(''); setPage(1); return; }
    // Detect URL input — extract the slug from path
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      try {
        const u = new URL(raw);
        const parts = u.pathname.replace(/^\/|\/$/g, '').split('/').filter(Boolean);
        if (parts.length === 0) {
          // Domain only — fetch front page
          setSearch('__front_page__'); setPage(1); return;
        }
        // Strip 2-3 char language prefix (e.g. /ar/slug/ → slug)
        const first = parts[0];
        if ((first.length === 2 || first.length === 3) && /^[a-z]+$/.test(first)) parts.shift();
        setSearch('__url__:' + raw); setPage(1); return;
      } catch {}
    }
    setSearch(raw); setPage(1);
  }
  function toggleSelect(id: number) { setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function toggleAll() { setSelected(selected.size === displayPages.length ? new Set() : new Set(displayPages.map(p => p.id))); }

  function openFilter() { setPendingTypes([...activeTypes]); setFilterOpen(true); }
  function applyFilter() { const a=getAllowedPostTypesForSite(activeSite); const filtered=a.length?pendingTypes.filter(t=>a.includes(t)):pendingTypes; setActiveTypes(filtered.length?filtered:a.length?[...a]:[]); setPage(1); setFilterOpen(false); }
  function clearFilter() { const a=getAllowedPostTypesForSite(activeSite); setPendingTypes([...a]); setActiveTypes([...a]); setPage(1); setFilterOpen(false); }
  function removeType(slug: string) { const a=getAllowedPostTypesForSite(activeSite); setActiveTypes(t => { const n=t.filter(x=>x!==slug); return n.length>0?n:[...a]; }); setPage(1); }

  async function quickTranslate() {
    if (!trModal || !trModal.selectedLangs.length) return;
    setTrModal(m => m ? { ...m, running: true } : null);
    const authH = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('bt_token') || '') };
    // Save non-empty page-specific prompts to page-config
    const toSave = Object.fromEntries(
      Object.entries(trModal.prompts).filter(([_, v]) => v && (v as string).trim())
    );
    const langModelsToSave = trModal.modelMap;
    if (Object.keys(toSave).length > 0 || Object.keys(langModelsToSave).length > 0) {
      await fetch(`/api/translate/page/${trModal.page.post_id}/config`, {
        method: 'PUT', headers: authH,
        body: JSON.stringify({ prompts: toSave, langModels: langModelsToSave }),
      }).catch(() => {});
    }
    let done = 0;
    for (const lang of trModal.selectedLangs) {
      try {
        const data = await fetch('/api/translate/page/async', {
          method: 'POST', headers: authH,
          body: JSON.stringify({ page_id: trModal.page.post_id, language: lang, force: trModal.forceMap[lang] || false }),
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
    setCfgModal({ pageId: p.id, title: p.title, api: '', model: '', globalApi: '', globalModel: '', loading: true });
    try {
      const cfg = await fetch(`/api/translate/page/${p.id}/config`).then(r => r.json());
      setCfgModal(m => {
        if (!m) return null;
        const allowedApi = getAllowedApi();
        const userIsRestricted = !isAdmin() && allowedApi !== 'all';
        let api = cfg.api || cfg.global_api || 'deepseek';
        if (userIsRestricted && !isApiAllowed(api as 'deepseek'|'openrouter')) {
          api = allowedApi === 'both' ? 'deepseek' : allowedApi;
        }
        const resolvedApi = (api || 'deepseek') as 'deepseek' | 'openrouter';
        const defMdl = resolvedApi === 'openrouter' ? 'openai/gpt-4o-mini' : 'deepseek-chat';
        const allowedMods = !isAdmin() ? getAllowedModelsForApi(resolvedApi) : [];
        let model = cfg.model || cfg.global_model || defMdl;
        if (allowedMods.length && !allowedMods.includes(model)) model = allowedMods[0];
        const globalApi = cfg.global_api || 'deepseek';
        const globalDefMdl = globalApi === 'openrouter' ? 'openai/gpt-4o-mini' : 'deepseek-chat';
        const globalModel = cfg.global_model || globalDefMdl;
        return { ...m, api, model, globalApi, globalModel, loading: false };
      });
    } catch { showAlert('Error loading config', false); setCfgModal(null); }
  }

  async function openReport(p: Page) {
    setReportModal({ page: p, data: null, loading: true });
    setExpandedLang(null);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('bt_token') : null;
      const res = await fetch(`/api/page-report/${p.post_id}`, {
        headers: token ? { Authorization: 'Bearer ' + token } : {},
      });
      if (res.ok) {
        const data: PageReport = await res.json();
        setReportModal(prev => prev ? { ...prev, data, loading: false } : null);
      } else {
        setReportModal(prev => prev ? { ...prev, loading: false } : null);
      }
    } catch {
      setReportModal(prev => prev ? { ...prev, loading: false } : null);
    }
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
  function getTranslatedUrl(pageUrl: string, langCode: string): string {
    try {
      const u = new URL(pageUrl);
      const path = u.pathname.replace(/\/+$/, '');
      return `${u.origin}/${langCode}${path}/`;
    } catch { return ''; }
  }
  function relevanceScore(p: Page, q: string): number {
    const t = (p.title || '').toLowerCase();
    const s = (p.slug  || '').toLowerCase();
    const u = (p.url   || '').toLowerCase();
    // Exact matches
    if (t === q)                         return 100;
    if (t.startsWith(q))                 return 92;
    if (t.includes(q))                   return 82;
    if (s === q)                         return 72;
    if (s.startsWith(q))                 return 62;
    if (s.includes(q) || u.includes(q))  return 52;
    // Multi-word: all words present in title scores high even if not contiguous
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length > 1 && words.every(w => t.includes(w))) return 75;
    if (words.length > 1 && words.every(w => s.includes(w) || u.includes(w))) return 45;
    // Partial word match in title
    if (words.some(w => t.includes(w))) return 30;
    return 10;
  }

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
            placeholder="Search by name or URL..." value={searchInput} onChange={e => setSearchInput(e.target.value)} />
          <button type="submit" className="bt-btn-secondary" style={D.btnSecondary}>Search</button>
          {search && (
            <button type="button" className="bt-btn-secondary" style={D.btnSecondary}
              onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}>Clear</button>
          )}
          {search && (
            <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, background: 'rgba(0,77,66,0.08)', color: D.brand, fontWeight: 600, border: `1px solid rgba(0,77,66,0.2)` }}>
              🔍 {search === '__front_page__' ? 'Showing home page' : search.startsWith('__url__:') ? `URL match · ${total} result${total !== 1 ? 's' : ''}` : `Searching across all types · ${total} result${total !== 1 ? 's' : ''}`}
            </span>
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
                    const allowed = getAllowedPostTypesForSite(activeSite);
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
                        <button onClick={() => setTrModal({ page: p, selectedLangs: [], step: 1, prompts: {}, forceMap: {}, modelMap: {}, running: false })}
                          style={{ ...D.btnPrimary, fontSize: 12, padding: '5px 12px' }}>Translate</button>
                        <button onClick={() => openCfgModal(p)}
                          style={{ ...D.btnSecondary, fontSize: 12, padding: '5px 12px' }}>AI Config</button>
                        <button onClick={() => setUrlModal(p)}
                          style={{ ...D.btnSecondary, fontSize: 12, padding: '5px 12px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <svg width={12} height={12} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round'><circle cx='12' cy='12' r='10'/><line x1='2' y1='12' x2='22' y2='12'/><path d='M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'/></svg>
                          URLs
                        </button>
                        <button onClick={() => openReport(p)}
                          style={{ ...D.btnSecondary, fontSize: 12, padding: '5px 12px', display: 'inline-flex', alignItems: 'center', gap: 4, color: '#7c3aed', borderColor: 'rgba(124,58,237,0.3)' }}>
                          <svg width={12} height={12} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round'><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/><polyline points='14 2 14 8 20 8'/><line x1='16' y1='13' x2='8' y2='13'/><line x1='16' y1='17' x2='8' y2='17'/><polyline points='10 9 9 9 8 9'/></svg>
                          Report
                        </button>
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
                        <div style={{ borderRadius: 6, border: `1.5px solid ${checked ? D.brand : D.border}`, background: checked ? 'rgba(0,77,66,0.05)' : '#fff', overflow: 'hidden' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer' }}>
                            <input type="checkbox" checked={checked}
                              onChange={() => setTrModal(m => m ? { ...m, selectedLangs: checked ? m.selectedLangs.filter(c => c !== l.code) : [...m.selectedLangs, l.code] } : null)}
                              style={{ accentColor: D.brand }} />
                            <FlagImg flag={l.flag} size={14} />
                            <span style={{ fontSize: 13, color: D.text1, flex: 1 }}>{l.name}</span>
                            {done && <span style={{ fontSize: 10, fontWeight: 700, color: '#10b981' }}>✓</span>}
                          </label>
                          {done && checked && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px 6px 28px', cursor: 'pointer', borderTop: '1px solid #e9eef3', background: trModal.forceMap[l.code] ? 'rgba(239,68,68,0.05)' : '#f8fafc' }}>
                              <input type="checkbox" checked={trModal.forceMap[l.code] || false}
                                onChange={e => setTrModal(m => m ? { ...m, forceMap: { ...m.forceMap, [l.code]: e.target.checked } } : null)}
                                style={{ accentColor: '#ef4444', width: 11, height: 11 }} />
                              <span style={{ fontSize: 10, color: trModal.forceMap[l.code] ? '#ef4444' : '#94a3b8', fontWeight: trModal.forceMap[l.code] ? 700 : 400 }}>Force re-translate</span>
                            </label>
                          )}
                        </div>
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
                          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
                            {trModal.prompts[code] === (langPromptMap[code] || globalPrompt || '') && !trModal.prompts[code] ? 'No custom prompt — using default'
                            : trModal.prompts[code] === langPromptMap[code] ? `Language default pre-filled — edit to override for this page only`
                            : trModal.prompts[code] === globalPrompt && !langPromptMap[code] ? 'Global default pre-filled — edit to override for this page only'
                            : 'Page-specific override — will be saved for this page'}
                          </div>
                          <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                            <label style={{ fontSize: 11, color: D.text3, whiteSpace: 'nowrap', minWidth: 60 }}>AI Model</label>
                            <select
                              value={trModal.modelMap[code]?.api || 'deepseek'}
                              onChange={e => setTrModal(m => m ? {...m, modelMap: {...m.modelMap, [code]: {api: e.target.value, model: ''}}} : null)}
                              style={{...D.select, fontSize: 12, padding: '4px 8px', flex: 1}}>
                              {(isAdmin() || isApiAllowed('deepseek')) && <option value="deepseek">DeepSeek</option>}
                              {(isAdmin() || isApiAllowed('openrouter')) && <option value="openrouter">OpenRouter</option>}
                            </select>
                            {isAdmin()
                              ? <ModelSelect
                                  api={trModal.modelMap[code]?.api || 'deepseek'}
                                  value={trModal.modelMap[code]?.model || ''}
                                  includeDefault={false}
                                  onChange={(model: string) => setTrModal(m => m ? {...m, modelMap: {...m.modelMap, [code]: {...(m.modelMap[code]||{api:'deepseek'}), model}}} : null)}
                                  style={{...D.select, fontSize: 12, padding: '4px 8px', flex: 2}}
                                />
                              : <select
                                  value={trModal.modelMap[code]?.model || ''}
                                  onChange={e => setTrModal(m => m ? {...m, modelMap: {...m.modelMap, [code]: {...(m.modelMap[code]||{api:'deepseek'}), model: e.target.value}}} : null)}
                                  style={{...D.select, fontSize: 12, padding: '4px 8px', flex: 2}}>
                                  {getAllowedModelsForApi((trModal.modelMap[code]?.api||'deepseek') as 'deepseek'|'openrouter').map(mid =>
                                    <option key={mid} value={mid}>{mid}</option>
                                  )}
                                </select>
                            }
                          </div>
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
                    onClick={() => setTrModal(m => {
                      if (!m) return null;
                      const filled: Record<string,string> = {};
                      const mmap: Record<string,{api:string,model:string}> = {};
                      for (const code of m.selectedLangs) {
                        filled[code] = m.prompts[code] || langPromptMap[code] || globalPrompt || '';
                        // Priority: lang-edit > page langModels > page global > global
                        const lc = langApiCfgs[code];
                        const plm = pageApiCfg.langModels[code];
                        const pgApi = pageApiCfg.api || ''; const pgMdl = pageApiCfg.model || (pgApi === 'openrouter' ? 'openai/gpt-4o-mini' : 'deepseek-chat'); const pg = pgApi ? {api: pgApi, model: pgMdl} : null;
                        const resolved = m.modelMap[code]?.model ? m.modelMap[code] : (lc?.api ? lc : (plm?.api ? plm : (pg || globalApiModel)));
                        let rApi = (resolved.api || 'deepseek') as string;
                        // Clamp to user's allowed api
                        const uAllowedApi = getAllowedApi(); const uRestricted = !isAdmin() && uAllowedApi !== 'all';
                        if (uRestricted && !isApiAllowed(rApi as 'deepseek'|'openrouter')) {
                          rApi = uAllowedApi === 'both' ? 'deepseek' : uAllowedApi;
                        }
                        const rDefMdl = rApi === 'openrouter' ? 'openai/gpt-4o-mini' : 'deepseek-chat';
                        let rModel = resolved.model || rDefMdl;
                        // Clamp to user's allowed models
                        if (uRestricted) {
                          const uMods = getAllowedModelsForApi(rApi as 'deepseek'|'openrouter');
                          if (uMods.length && !uMods.includes(rModel)) rModel = uMods[0];
                        }
                        mmap[code] = {api: rApi, model: rModel};
                      }
                      return { ...m, step: 2, prompts: filled, modelMap: mmap };
                    })}>
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
                        <option value="deepseek">DeepSeek</option>
                        <option value="openrouter">OpenRouter</option>
                      </>
                    ) : (
                      <>
                        {isApiAllowed('deepseek') && <option value="deepseek">DeepSeek</option>}
                        {isApiAllowed('openrouter') && <option value="openrouter">OpenRouter</option>}
                      </>
                    )}
                  </select>
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label style={D.label}>Model</label>
                  {isAdmin()
                    ? <ModelSelect api={cfgModal.api || 'deepseek'} value={cfgModal.model} includeDefault={false}
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
      {urlModal && (
        <div className='bt-overlay' onClick={e => { if (e.target === e.currentTarget) setUrlModal(null); }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '28px 32px', width: '100%', maxWidth: 620,
            maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.18)', position: 'relative' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: D.text1 }}>Translation URLs</h2>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: D.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 460 }}>{urlModal.title}</p>
              </div>
              <button onClick={() => setUrlModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: D.text3, fontSize: 20, lineHeight: 1, padding: 0, marginLeft: 12 }}>✕</button>
            </div>
            {/* English (original) */}
            <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 600, color: D.text3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Original</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#f8fafc',
              border: `1px solid ${D.border}`, borderRadius: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 18 }}>🇬🇧</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: D.text1, marginBottom: 2 }}>English</div>
                <div style={{ fontSize: 11, color: D.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{urlModal.url}</div>
              </div>
              <a href={urlModal.url} target='_blank' rel='noopener noreferrer'
                style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 6,
                  background: D.brand, color: '#fff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <svg width={10} height={10} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={2.5}><path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'/><polyline points='15 3 21 3 21 9'/><line x1='10' y1='14' x2='21' y2='3'/></svg>
                Open
              </a>
            </div>
            {/* Translated languages */}
            <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 600, color: D.text3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Translations ({urlModal.translated_languages?.length || 0})</div>
            {(!urlModal.translated_languages || urlModal.translated_languages.length === 0) && (
              <div style={{ padding: '16px', textAlign: 'center', color: D.text3, fontSize: 13, background: '#f8fafc', borderRadius: 8, border: `1px solid ${D.border}` }}>No translations yet for this page.</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(urlModal.translated_languages || []).map(code => {
                const li = getLang(code);
                const tUrl = getTranslatedUrl(urlModal.url, code);
                return (
                  <div key={code} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                    border: `1px solid ${D.border}`, borderRadius: 8, background: '#fff', transition: 'background 0.1s' }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{li?.flag ? <FlagImg flag={li.flag} size={20} /> : '🌐'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: D.text1, marginBottom: 2 }}>{li?.name || code.toUpperCase()}</div>
                      <div style={{ fontSize: 11, color: D.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tUrl}</div>
                    </div>
                    <a href={tUrl} target='_blank' rel='noopener noreferrer'
                      style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 6,
                        background: D.brand, color: '#fff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <svg width={10} height={10} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={2.5}><path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'/><polyline points='15 3 21 3 21 9'/><line x1='10' y1='14' x2='21' y2='3'/></svg>
                      Open
                    </a>
                  </div>
                );
              })}
            </div>
            {/* Footer */}
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${D.border}`, display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setUrlModal(null)} style={{ ...D.btnSecondary, fontSize: 13 }}>Close</button>
            </div>
          </div>
        </div>
      )}
      {/* Report Modal */}
      {reportModal && (
        <div className="bt-overlay" onClick={e => { if (e.target === e.currentTarget) { setReportModal(null); setExpandedLang(null); } }}>
          <div className="bt-modal" style={{ maxWidth: 680, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: D.text1 }}>Translation Report</h2>
                <p style={{ margin: 0, fontSize: 12, color: D.text3, maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{reportModal.page.title}</p>
              </div>
              <button onClick={() => { setReportModal(null); setExpandedLang(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: D.text3, fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
            </div>

            {reportModal.loading ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: D.text3, fontSize: 13 }}>Loading report...</div>
            ) : !reportModal.data || reportModal.data.languages.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: D.text3, fontSize: 13 }}>No translations found for this page yet.</div>
            ) : (
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {/* Summary bar */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                  {[
                    { label: 'Total Runs',   value: reportModal.data.total_translations, color: '#3b82f6' },
                    { label: 'Languages',    value: reportModal.data.languages.length,   color: '#10b981' },
                    { label: 'Re-translated', value: reportModal.data.languages.filter(l => l.count > 1).length, color: '#f59e0b' },
                  ].map(s => (
                    <div key={s.label} style={{ flex: 1, minWidth: 120, padding: '10px 14px', borderRadius: 8, background: `${s.color}0f`, border: `1px solid ${s.color}25` }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: 11, color: D.text3, marginTop: 2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Language rows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {reportModal.data.languages.map(lang => {
                    const isExpanded = expandedLang === lang.language;
                    const isRepeat   = lang.count > 1;
                    const last       = lang.history[0];
                    const lastDate   = last ? new Date(last.timestamp).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
                    return (
                      <div key={lang.language} style={{ border: `1.5px solid ${isRepeat ? 'rgba(245,158,11,0.35)' : D.border}`, borderRadius: 8, overflow: 'hidden', background: isRepeat ? 'rgba(245,158,11,0.02)' : '#fff' }}>
                        {/* Row header */}
                        <div onClick={() => setExpandedLang(isExpanded ? null : lang.language)}
                          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer', userSelect: 'none' }}>
                          <div style={{ width: 36, height: 36, borderRadius: 8, background: isRepeat ? 'rgba(245,158,11,0.12)' : 'rgba(0,77,66,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: isRepeat ? '#d97706' : D.brand }}>{lang.language.toUpperCase()}</span>
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: D.text1, display: 'flex', alignItems: 'center', gap: 8 }}>
                              {lang.language_name || lang.language}
                              {isRepeat && (
                                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: 'rgba(245,158,11,0.12)', color: '#d97706', border: '1px solid rgba(245,158,11,0.3)' }}>
                                  Re-translated {lang.count}×
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: D.text3, marginTop: 2 }}>Last: {lastDate} · by {last?.user_name || '—'}</div>
                          </div>
                          <div style={{ fontSize: 11, color: D.text3, textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontWeight: 700, color: D.text2, fontSize: 15 }}>{lang.count}</div>
                            <div>run{lang.count !== 1 ? 's' : ''}</div>
                          </div>
                          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={D.text3} strokeWidth={2} strokeLinecap="round" style={{ flexShrink: 0, transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
                            <polyline points="6 9 12 15 18 9"/>
                          </svg>
                        </div>
                        {/* History table */}
                        {isExpanded && (
                          <div style={{ borderTop: `1px solid ${D.border}`, background: '#fafbfc' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                              <thead>
                                <tr style={{ background: '#f1f5f9' }}>
                                  {['#', 'Date & Time', 'By', 'API', 'Model'].map(h => (
                                    <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600, color: D.text3, borderBottom: `1px solid ${D.border}` }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {lang.history.map((h, i) => (
                                  <tr key={i} style={{ borderBottom: i < lang.history.length - 1 ? `1px solid ${D.border}` : 'none' }}>
                                    <td style={{ padding: '7px 12px', color: D.text3 }}>{i + 1}</td>
                                    <td style={{ padding: '7px 12px', color: D.text2, whiteSpace: 'nowrap' }}>
                                      {new Date(h.timestamp).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}
                                    </td>
                                    <td style={{ padding: '7px 12px', color: D.text2 }}>{h.user_name}</td>
                                    <td style={{ padding: '7px 12px', color: D.text2, textTransform: 'capitalize' }}>{h.api}</td>
                                    <td style={{ padding: '7px 12px', color: D.text3, fontFamily: 'monospace', fontSize: 11, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.model}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${D.border}`, display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => { setReportModal(null); setExpandedLang(null); }} style={{ ...D.btnSecondary, fontSize: 13 }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
