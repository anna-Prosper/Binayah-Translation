'use client';
import { getAllowedLangs, getAllowedApi, getAllowedModels, getAllowedPostTypes, defaultLang, defaultApi, defaultModel, isAdmin, isApiAllowed, getAllowedModelsForApi } from '../lib/perms';
import { useEffect, useState, useRef } from 'react';
import { addJob } from '../components/JobsMonitor';
import { useLanguages, FlagImg } from '../lib/useLanguages';
import { ModelSelect } from '../lib/useModels';
import Shell, { D, Alert } from '../components/Shell';
import PromptBox from '../components/PromptBox';

function isSkippable(text: string) {
  if (!text) return true;
  const t = text.trim();
  if (t.length <= 2) return true;
  if (/^https?:\/\//i.test(t)) return true;
  if (/^\d+(\.\d+)?$/.test(t)) return true;
  if (/^[\d\s,.\-+()%\/]+$/.test(t)) return true;
  if (/\.(jpg|jpeg|png|gif|webp|svg|pdf)(\?.*)?$/i.test(t)) return true;
  if (/^[a-z][a-z0-9_\-]{1,29}$/.test(t)) return true;
  return false;
}

function LoadIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  );
}

function TranslateIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 8 6 6"/>
      <path d="m4 14 6-6 2-3"/>
      <path d="M2 5h12"/>
      <path d="M7 2h1"/>
      <path d="m22 22-5-10-5 10"/>
      <path d="M14 18h6"/>
    </svg>
  );
}

interface Field { key: string; original: string; translated: string; }
interface JobState { status: string; progress: number; total: number; current_field: string; current_lang: string; page_title: string; results: any[] | null; error: string | null; }

export default function TranslatePage() {
  const { languages }             = useLanguages();
  const [pageId,       setPageId]       = useState('');
  const [lang,         setLang]         = useState(() => defaultLang());
  const [selectedApi,  setSelectedApi]  = useState('');
  const [selectedModel,setSelectedModel]= useState('');
  const [pageLoaded,   setPageLoaded]   = useState(false);
  const [fields,       setFields]       = useState<Field[]>([]);
  const [pageTitle,    setPageTitle]    = useState('');
  const [loading,      setLoading]      = useState(false);
  const [jobState,     setJobState]     = useState<JobState | null>(null);
  const [jobId,        setJobId]        = useState<string | null>(null);
  const [msg,          setMsg]          = useState<{text:string;ok:boolean}|null>(null);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [permPopup,      setPermPopup]      = useState('');
  const [pageNotAllowed, setPageNotAllowed] = useState(false);
  const [customPrompt,   setCustomPrompt]   = useState('');
  const [promptLoading,  setPromptLoading]  = useState(false);
  const [editingKey,   setEditingKey]   = useState<string | null>(null);
  const [editValue,    setEditValue]    = useState('');
  const [savingKey,    setSavingKey]    = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const data: JobState = await fetch(`/api/translate/progress/${jobId}`).then(r => r.json());
        if (cancelled) return;
        setJobState(data);
        if (data.status === 'running') {
          pollRef.current = setTimeout(poll, 1500);
        } else if (data.status === 'done') {
          setJobId(null);
          setMsg({ text: `Done! ${data.results?.reduce((s, r) => s + r.translated, 0) || 0} fields translated.`, ok: true });
          reloadTranslations();
        } else if (data.status === 'error') {
          setJobId(null);
          setMsg({ text: data.error || 'Translation failed', ok: false });
        }
      } catch { if (!cancelled) pollRef.current = setTimeout(poll, 3000); }
    };
    poll();
    return () => { cancelled = true; if (pollRef.current) clearTimeout(pollRef.current); };
  }, [jobId]);

  async function loadPage() {
    if (!pageId) return;
    setLoading(true); setMsg(null); setFields([]); setPageTitle('');
    // Check post type permission BEFORE loading
    const allowedPT = getAllowedPostTypes();
    if (allowedPT.length > 0) {
      try {
        const ptCheck = await fetch(`/api/page/${pageId}/content`).then(r=>r.json());
        if (ptCheck.post_type && !allowedPT.includes(ptCheck.post_type)) {
          setPermPopup('You do not have permission to translate pages of this type. Contact your administrator.');
          setPageNotAllowed(true);
          setLoading(false);
          return;
        }
      } catch {}
    }

    try {
      const [contentRes, trRes, cfgRes, langCfgsRes] = await Promise.all([
        fetch(`/api/page/${pageId}/content`),
        fetch(`/api/page/${pageId}/translations?lang=${lang}`),
        fetch(`/api/translate/page/${pageId}/config`),
        fetch('/api/languages/config'),
      ]);
      const data     = await contentRes.json();
      const trData   = trRes.ok ? await trRes.json() : {};
      const cfg      = cfgRes.ok ? await cfgRes.json() : {};
      const langCfgs = langCfgsRes.ok ? await langCfgsRes.json() : [];
      setPageNotAllowed(false);
      setPageTitle(data.post_title || '');
      // Resolve full hierarchy: page per-lang > lang edit > page ai config > global
      const pageLang  = ((cfg.langModels || {})[lang]) || {};
      const langCfg   = ((langCfgs || []) as any[]).find(l => l.code === lang) || {};
      let resolvedApi = (pageLang.api || langCfg.api || cfg.api || cfg.global_api || 'deepseek') as 'deepseek' | 'openrouter';
      // Respect user permissions
      const uApi = getAllowedApi(); const uRestricted = !isAdmin() && uApi !== 'all';
      if (uRestricted && !isApiAllowed(resolvedApi)) {
        resolvedApi = (uApi === 'both' ? 'deepseek' : uApi) as 'deepseek' | 'openrouter';
      }
      const defMdl = resolvedApi === 'openrouter' ? 'openai/gpt-4o-mini' : 'deepseek-chat';
      let resolvedModel = pageLang.model || langCfg.model || cfg.model || cfg.global_model || defMdl;
      if (uRestricted) {
        const uMods = getAllowedModelsForApi(resolvedApi);
        if (uMods.length && !uMods.includes(resolvedModel)) resolvedModel = uMods[0];
      }
      setSelectedApi(resolvedApi);
      setSelectedModel(resolvedModel);
      setPageLoaded(true);
      setFields(
        Object.entries(data.fields || {})
          .map(([key, val]: [string, any]) => ({ key, original: typeof val === 'object' ? val.value : val, translated: trData[key] || '' }))
          .filter(f => !isSkippable(f.original))
      );
    } catch { setMsg({ text: 'Failed to load page', ok: false }); }
    finally { setLoading(false); }
  }

  async function reloadTranslations() {
    try {
      const trData = await fetch(`/api/page/${pageId}/translations?lang=${lang}`).then(r => r.json());
      setFields(prev => prev.map(f => ({ ...f, translated: trData[f.key] || f.translated })));
    } catch {}
  }

  async function openPromptModal() {
    if (!fields.length) return;
    setPromptLoading(true);
    setShowPromptModal(true);
    try {
      const d = await fetch(`/api/translate/page/${pageId}/prompt?lang=${lang}`).then(r => r.json());
      setCustomPrompt(d.resolved || '');
    } catch { setCustomPrompt(''); }
    setPromptLoading(false);
  }

  async function startTranslation() {
    setMsg(null); setJobState(null);
    const body: any = { page_id: parseInt(pageId), language: lang };
    if (customPrompt && customPrompt.trim()) body.prompts = { [lang]: customPrompt };
    if (selectedApi)   body.api   = selectedApi;
    if (selectedModel) body.model = selectedModel;
    const data = await fetch('/api/translate/page/async', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('bt_token') || '') }, body: JSON.stringify(body),
    }).then(r => r.json());
    if (data.job_id) {
      setJobId(data.job_id);
      addJob({ job_id: data.job_id, lang, page_id: parseInt(pageId), page_title: pageTitle });
      setJobState({ status: 'running', progress: 0, total: fields.length, current_field: '', current_lang: lang, page_title: pageTitle, results: null, error: null });
    } else {
      setMsg({ text: data.error || 'Failed to start translation', ok: false });
    }
  }

  async function saveEdit(fieldKey: string) {
    setSavingKey(fieldKey);
    try {
      const res = await fetch('/api/translate/field', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_id: parseInt(pageId), language: lang, field_key: fieldKey, value: editValue }),
      });
      if (res.ok) {
        setFields(prev => prev.map(f => f.key === fieldKey ? { ...f, translated: editValue } : f));
        setEditingKey(null);
        setMsg({ text: 'Field saved successfully!', ok: true });
      } else { setMsg({ text: 'Save failed', ok: false }); }
    } catch { setMsg({ text: 'Connection error', ok: false }); }
    setSavingKey(null);
  }

  const langInfo   = languages.find(l => l.code === lang);
  const isRTL      = lang === 'ar' || lang === 'fa';
  const doneCount  = fields.filter(f => f.translated).length;
  const isRunning  = jobState?.status === 'running';
  const pct        = jobState && jobState.total > 0 ? Math.round((jobState.progress / jobState.total) * 100) : 0;
  const effectiveApi = selectedApi || 'deepseek';

  return (
    <Shell>
      <h1 style={D.pageTitle}>Translate Page</h1>
      <p style={D.pageSub}>Translate page fields with live progress and manual editing</p>

      {/* Controls */}
      <div style={{ ...D.cardLg, marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 120 }}>
          <label style={D.label}>Page ID</label>
          <input value={pageId} onChange={e => { setPageId(e.target.value); setPageNotAllowed(false); setFields([]); setPageTitle(''); setPageLoaded(false); setSelectedApi(''); setSelectedModel(''); }} placeholder="Enter page ID…" style={D.input} />
        </div>
        <div>
          <label style={D.label}>Language</label>
          <select value={lang} onChange={e => setLang(e.target.value)} style={D.select}>
            {languages.filter(l=>{const a=getAllowedLangs();return !a.length||a.includes(l.code);}).map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label style={D.label}>API</label>
          {!pageLoaded
            ? <select disabled style={{...D.select,minWidth:140}}><option value="">—</option></select>
            : <select value={selectedApi} onChange={e => { setSelectedApi(e.target.value); setSelectedModel(''); }} style={{ ...D.select, minWidth: 140 }}>
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
          }
        </div>
        <div>
          <label style={D.label}>Model</label>
          {!pageLoaded
            ? <select disabled style={{...D.select,minWidth:200}}><option value="">—</option></select>
            : isAdmin()
              ? <ModelSelect api={effectiveApi} value={selectedModel} onChange={setSelectedModel} includeDefault={false}
                  style={{ ...D.select, minWidth: 200 }} />
              : <select value={selectedModel} onChange={e=>setSelectedModel(e.target.value)} style={{...D.select,minWidth:200}}>
                  {(()=>{
                    const allowed = getAllowedModelsForApi(effectiveApi as 'deepseek'|'openrouter');
                    const dsAll = [{id:'deepseek-chat',name:'DeepSeek Chat (V3)'},{id:'deepseek-reasoner',name:'DeepSeek Reasoner (R1)'}];
                    const orFallback = ['openai/gpt-4o-mini','openai/gpt-5-mini','openai/gpt-5','anthropic/claude-3.5-sonnet'];
                    const list = effectiveApi==='deepseek'
                      ? (allowed.length ? dsAll.filter(m=>allowed.includes(m.id)) : dsAll).map(m=>({id:m.id,label:m.name}))
                      : (allowed.length ? allowed : orFallback).map(id=>({id,label:id}));
                    return list.map(m=><option key={m.id} value={m.id}>{m.label}</option>);
                  })()}
                </select>
          }
        </div>
        <button onClick={loadPage} disabled={loading || isRunning} className="bt-btn-secondary"
          style={{ ...D.btnSecondary, opacity: loading || isRunning ? 0.4 : 1 }}>
          <LoadIcon /> {loading ? 'Loading…' : 'Load'}
        </button>
        <button onClick={openPromptModal} disabled={isRunning || !fields.length} className="bt-btn-primary"
          style={{ ...D.btnPrimary, opacity: isRunning || !fields.length ? 0.4 : 1 }}>
          {isRunning ? (
            `Translating… ${pct}%`
          ) : (
            <><TranslateIcon /> Translate to {langInfo?.name}</>
          )}
        </button>
      </div>

      {selectedApi && fields.length > 0 && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, background: 'rgba(0,77,66,0.06)', border: '1px solid rgba(0,77,66,0.15)', fontSize: 12, color: D.text2, marginBottom: 12 }}>
          Using: <strong style={{ color: D.brand }}>{selectedApi === 'openrouter' ? 'OpenRouter' : 'DeepSeek'}</strong>
          {selectedModel && <><span style={{ color: D.text3 }}>—</span><strong style={{ color: D.brand }}>{selectedModel}</strong></>}
          <span style={{ color: D.text3 }}>(saved for this page)</span>
        </div>
      )}

      {/* Progress bar */}
      {isRunning && jobState && (
        <div style={{ ...D.cardLg, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: '500', color: D.text1 }}>
              {langInfo && <FlagImg flag={langInfo.flag} size={16} />} Translating {langInfo?.name}…
            </span>
            <span style={{ fontSize: 13, fontWeight: '700', color: D.brand }}>{jobState.progress} / {jobState.total}</span>
          </div>
          <div style={{ background: '#e2e8f0', borderRadius: 99, height: 8, overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(90deg, #004D42, #00897B)', height: 8, borderRadius: 99, width: pct + '%', transition: 'width 0.5s ease' }} />
          </div>
          {jobState.current_field && (
            <div style={{ fontSize: 11, color: D.text3, marginTop: 6 }}>
              Field: <code style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 3, color: D.brand }}>{jobState.current_field}</code>
            </div>
          )}
        </div>
      )}

      <Alert msg={msg} />

      {/* Page info */}
      {pageTitle && (
        <div style={{ ...D.card, marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: '600', fontSize: 14, color: D.text1 }}>{pageTitle}</div>
            <div style={{ fontSize: 12, color: D.text3, marginTop: 2 }}>ID: {pageId} · {fields.length} translatable fields</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 22, fontWeight: '700', color: doneCount === fields.length && fields.length > 0 ? '#10b981' : '#f59e0b' }}>{doneCount}/{fields.length}</div>
            <div style={{ fontSize: 11, color: D.text3 }}>{langInfo && <FlagImg flag={langInfo.flag} size={14} />} translated</div>
          </div>
        </div>
      )}

      {/* Fields table */}
      {fields.length > 0 && (
        <div style={{ ...D.card, padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 1fr 68px', padding: '10px 16px', borderBottom: `1px solid ${D.border}`, fontSize: 10, fontWeight: '700', color: D.text3, textTransform: 'uppercase', letterSpacing: '0.06em', background: '#f8fafc' }}>
            <div>Field</div>
            <div>Original (EN)</div>
            <div>{langInfo && <FlagImg flag={langInfo.flag} size={14} />} {langInfo?.name}</div>
            <div style={{ textAlign: 'center' }}>Edit</div>
          </div>

          {fields.map((field, idx) => {
            const isEditing = editingKey === field.key;
            return (
              <div key={field.key} className="bt-row" style={{
                display: 'grid', gridTemplateColumns: '160px 1fr 1fr 68px',
                borderBottom: idx < fields.length - 1 ? `1px solid ${D.border}` : 'none',
                alignItems: 'start',
                background: isEditing ? '#f0fdf4' : '#fff',
              }}>
                <div style={{ padding: '11px 14px', borderRight: `1px solid ${D.border}` }}>
                  <span style={{ fontSize: 10, fontWeight: '600', color: D.text3, background: '#f1f5f9', border: `1px solid ${D.border}`, padding: '2px 7px', borderRadius: 3, wordBreak: 'break-all', display: 'inline-block' }}>
                    {field.key.replace(/^(wpbakery|acf|elementor):/, '')}
                  </span>
                </div>
                <div style={{ padding: '11px 14px', borderRight: `1px solid ${D.border}`, fontSize: 13, color: D.text2, lineHeight: 1.5, wordBreak: 'break-word' }}>
                  {field.original.length > 200 ? field.original.slice(0, 200) + '…' : field.original}
                </div>
                <div style={{ padding: '11px 14px', borderRight: `1px solid ${D.border}`, lineHeight: 1.5, wordBreak: 'break-word', direction: isRTL ? 'rtl' : 'ltr' }}>
                  {isEditing ? (
                    <div>
                      <textarea value={editValue} onChange={e => setEditValue(e.target.value)}
                        style={{ width: '100%', minHeight: 80, padding: 8, borderRadius: 6, border: `1px solid ${D.border}`, background: '#fff', color: D.text1, fontSize: 13, outline: 'none', resize: 'vertical', direction: isRTL ? 'rtl' : 'ltr', boxSizing: 'border-box' }} />
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <button onClick={() => saveEdit(field.key)} disabled={savingKey === field.key}
                          className="bt-btn-primary" style={{ ...D.btnPrimary, padding: '5px 14px', fontSize: 12 }}>
                          {savingKey === field.key ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => setEditingKey(null)} className="bt-btn-secondary"
                          style={{ ...D.btnSecondary, padding: '5px 12px', fontSize: 12 }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <span style={{ fontSize: 13, color: field.translated ? D.text1 : D.text3 }}>
                      {field.translated || <em style={{ fontSize: 12 }}>Not translated</em>}
                    </span>
                  )}
                </div>
                <div style={{ padding: '11px 6px', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
                  {!isEditing && (
                    <button onClick={() => { setEditingKey(field.key); setEditValue(field.translated || field.original); }}
                      title="Edit translation"
                      style={{ background: '#fff', border: `1px solid ${D.border}`, borderRadius: 5, padding: '4px 10px', cursor: 'pointer', fontSize: 13, color: D.text2, transition: 'border-color 0.12s ease' }}>
                      ✎
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && !fields.length && (
        <div style={{ ...D.card, padding: 60, textAlign: 'center', color: D.text3, fontSize: 13 }}>
          Enter a page ID and click Load to view fields
        </div>
      )}

      {showPromptModal && (
        <div className="bt-overlay" onClick={e => { if (e.target === e.currentTarget) setShowPromptModal(false); }}>
          <div className="bt-modal" style={{ maxWidth: 520 }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: D.text1 }}>Translation Prompt</h2>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: D.text3 }}>
              {pageTitle} → {languages.find(l => l.code === lang)?.name || lang}
            </p>
            {promptLoading ? (
              <p style={{ color: D.text3, fontSize: 13 }}>Loading prompt…</p>
            ) : (
              <>
                <div style={{ marginBottom: 16 }}>
                  <PromptBox label="Translation Prompt" value={customPrompt} onChange={setCustomPrompt} rows={8} />
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button className="bt-btn-secondary" style={D.btnSecondary} onClick={() => setShowPromptModal(false)}>Cancel</button>
                  <button className="bt-btn-primary" style={D.btnPrimary} onClick={() => { setShowPromptModal(false); startTranslation(); }}>
                    Start Translation
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Permission denied popup */}
      {permPopup && (
        <div className="bt-overlay" onClick={()=>setPermPopup('')}>
          <div className="bt-modal" style={{ maxWidth:420, textAlign:'center' }}>
            <div style={{ width:52,height:52,borderRadius:'50%',background:'rgba(239,68,68,0.1)',border:'2px solid rgba(239,68,68,0.2)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 16px' }}>
              <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth={2} strokeLinecap="round"><rect x={3} y={11} width={18} height={11} rx={2}/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </div>
            <h3 style={{ margin:'0 0 10px',fontSize:16,fontWeight:700,color:'#111' }}>Access Restricted</h3>
            <p style={{ margin:'0 0 20px',fontSize:13,color:'#64748b',lineHeight:1.6 }}>{permPopup}</p>
            <button onClick={()=>setPermPopup('')} style={D.btnPrimary}>OK</button>
          </div>
        </div>
      )}
    </Shell>
  );
}
