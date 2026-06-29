'use client';
import React, { useEffect, useState } from 'react';
import Shell, { D, Alert } from '../components/Shell';
import { ModelSelect } from '../lib/useModels';
import PromptBox from '../components/PromptBox';
import { FlagImg } from '../lib/useLanguages';
import { isAdmin, getAllowedApi, isApiAllowed, getAllowedModelsForApi } from '../lib/perms';

interface Language {
  code: string; name: string; flag: string; native?: string; dir?: string;
  api?: string; model?: string; countries?: string[]; enabled?: boolean; prompt?: string; word_cache?: boolean;
}
interface Stats { by_language: Record<string, number>; total_posts: number; }

const KNOWN_LANGUAGES = [
  { code: 'ar', name: 'Arabic',      flag: '🇸🇦', dir: 'rtl' },
  { code: 'fr', name: 'French',      flag: '🇫🇷', dir: 'ltr' },
  { code: 'es', name: 'Spanish',     flag: '🇪🇸', dir: 'ltr' },
  { code: 'de', name: 'German',      flag: '🇩🇪', dir: 'ltr' },
  { code: 'ru', name: 'Russian',     flag: '🇷🇺', dir: 'ltr' },
  { code: 'zh', name: 'Chinese',     flag: '🇨🇳', dir: 'ltr' },
  { code: 'hi', name: 'Hindi',       flag: '🇮🇳', dir: 'ltr' },
  { code: 'it', name: 'Italian',     flag: '🇮🇹', dir: 'ltr' },
  { code: 'pt', name: 'Portuguese',  flag: '🇵🇹', dir: 'ltr' },
  { code: 'fa', name: 'Persian',     flag: '🇮🇷', dir: 'rtl' },
  { code: 'ja', name: 'Japanese',    flag: '🇯🇵', dir: 'ltr' },
  { code: 'ko', name: 'Korean',      flag: '🇰🇷', dir: 'ltr' },
  { code: 'tr', name: 'Turkish',     flag: '🇹🇷', dir: 'ltr' },
  { code: 'nl', name: 'Dutch',       flag: '🇳🇱', dir: 'ltr' },
  { code: 'pl', name: 'Polish',      flag: '🇵🇱', dir: 'ltr' },
  { code: 'he', name: 'Hebrew',      flag: '🇮🇱', dir: 'rtl' },
  { code: 'ur', name: 'Urdu',        flag: '🇵🇰', dir: 'rtl' },
  { code: 'bn', name: 'Bengali',     flag: '🇧🇩', dir: 'ltr' },
  { code: 'ms', name: 'Malay',       flag: '🇲🇾', dir: 'ltr' },
  { code: 'vi', name: 'Vietnamese',  flag: '🇻🇳', dir: 'ltr' },
  { code: 'id', name: 'Indonesian',  flag: '🇮🇩', dir: 'ltr' },
  { code: 'th', name: 'Thai',        flag: '🇹🇭', dir: 'ltr' },
  { code: 'sv', name: 'Swedish',     flag: '🇸🇪', dir: 'ltr' },
  { code: 'no', name: 'Norwegian',   flag: '🇳🇴', dir: 'ltr' },
  { code: 'da', name: 'Danish',      flag: '🇩🇰', dir: 'ltr' },
  { code: 'fi', name: 'Finnish',     flag: '🇫🇮', dir: 'ltr' },
  { code: 'cs', name: 'Czech',       flag: '🇨🇿', dir: 'ltr' },
  { code: 'ro', name: 'Romanian',    flag: '🇷🇴', dir: 'ltr' },
  { code: 'hu', name: 'Hungarian',   flag: '🇭🇺', dir: 'ltr' },
  { code: 'el', name: 'Greek',       flag: '🇬🇷', dir: 'ltr' },
];

const COUNTRY_OPTIONS = [
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'QA', name: 'Qatar' },
  { code: 'KW', name: 'Kuwait' },
  { code: 'BH', name: 'Bahrain' },
  { code: 'OM', name: 'Oman' },
  { code: 'EG', name: 'Egypt' },
  { code: 'JO', name: 'Jordan' },
  { code: 'LB', name: 'Lebanon' },
  { code: 'IQ', name: 'Iraq' },
  { code: 'SY', name: 'Syria' },
  { code: 'YE', name: 'Yemen' },
  { code: 'LY', name: 'Libya' },
  { code: 'TN', name: 'Tunisia' },
  { code: 'DZ', name: 'Algeria' },
  { code: 'MA', name: 'Morocco' },
  { code: 'SD', name: 'Sudan' },
  { code: 'FR', name: 'France' },
  { code: 'BE', name: 'Belgium' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'MC', name: 'Monaco' },
  { code: 'DE', name: 'Germany' },
  { code: 'AT', name: 'Austria' },
  { code: 'RU', name: 'Russia' },
  { code: 'UA', name: 'Ukraine' },
  { code: 'BY', name: 'Belarus' },
  { code: 'KZ', name: 'Kazakhstan' },
  { code: 'CN', name: 'China' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'SG', name: 'Singapore' },
  { code: 'IN', name: 'India' },
  { code: 'IR', name: 'Iran' },
  { code: 'IT', name: 'Italy' },
  { code: 'PT', name: 'Portugal' },
  { code: 'BR', name: 'Brazil' },
  { code: 'ES', name: 'Spain' },
  { code: 'MX', name: 'Mexico' },
  { code: 'AR', name: 'Argentina' },
  { code: 'CO', name: 'Colombia' },
  { code: 'CL', name: 'Chile' },
  { code: 'PE', name: 'Peru' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'TR', name: 'Turkey' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'PL', name: 'Poland' },
  { code: 'IL', name: 'Israel' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'TH', name: 'Thailand' },
  { code: 'PH', name: 'Philippines' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'KE', name: 'Kenya' },
  { code: 'ET', name: 'Ethiopia' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' },
  { code: 'FI', name: 'Finland' },
  { code: 'GR', name: 'Greece' },
  { code: 'RO', name: 'Romania' },
  { code: 'HU', name: 'Hungary' },
  { code: 'CZ', name: 'Czech Republic' },
];

const emptyForm = { code: '', api: '', model: '', countries: [] as string[], enabled: true, prompt: '', word_cache: true };

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + (localStorage.getItem('bt_token') || ''),
  };
}

function CountryMultiSelect({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {

  const [search, setSearch] = useState('');
  const filtered = COUNTRY_OPTIONS.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) || c.code.toLowerCase().includes(search.toLowerCase())
  );
  function toggle(code: string) {
    onChange(value.includes(code) ? value.filter(c => c !== code) : [...value, code]);
  }
  return (
    <div>
      <input style={{ ...D.input, marginBottom: 6 }} placeholder="Search countries..." value={search}
        onChange={e => setSearch(e.target.value)} className="bt-input-focus" />
      <div style={{ maxHeight: 180, overflowY: 'auto', border: `1px solid ${D.border}`, borderRadius: 6, background: '#fff' }}>
        {filtered.map(c => (
          <label key={c.code} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer',
            background: value.includes(c.code) ? 'rgba(0,77,66,0.06)' : 'transparent',
            borderBottom: `1px solid ${D.border}`,
          }}>
            <input type="checkbox" checked={value.includes(c.code)} onChange={() => toggle(c.code)} style={{ accentColor: D.brand }} />
            <span className={'fi fi-' + c.code.toLowerCase()} style={{ fontSize: 14 }} />
            <span style={{ fontSize: 13, color: D.text1, flex: 1 }}>{c.name}</span>
            <span style={{ fontSize: 11, color: D.text3 }}>{c.code}</span>
          </label>
        ))}
        {filtered.length === 0 && <div style={{ padding: '10px', fontSize: 12, color: D.text3, textAlign: 'center' }}>No countries found</div>}
      </div>
      {value.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {value.map(code => {
            const c = COUNTRY_OPTIONS.find(x => x.code === code);
            return (
              <span key={code} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '2px 7px', borderRadius: 4, background: 'rgba(0,77,66,0.08)', border: `1px solid rgba(0,77,66,0.2)`, color: D.brand }}>
                <span className={'fi fi-' + code.toLowerCase()} style={{ fontSize: 11 }} />
                {c?.name || code}
                <button onClick={() => toggle(code)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: D.text3, padding: 0, fontSize: 12, lineHeight: 1, marginLeft: 2 }}>x</button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function LanguagesPage() {
  const [languages, setLanguages] = useState<Language[]>([]);
  const [loading, setLoading]     = useState(true);
  const [stats, setStats]         = useState<Stats | null>(null);
  const [alert, setAlert]         = useState<{ text: string; ok: boolean } | null>(null);
  const [showAdd, setShowAdd]     = useState(false);
  const [editLang, setEditLang]   = useState<Language | null>(null);
  const [form, setForm]           = useState({ ...emptyForm });
  const [saving, setSaving]       = useState(false);
  const [globalCfg, setGlobalCfg] = useState<{api:string,model:string}>({api:'deepseek',model:''});

  function showMsg(text: string, ok: boolean) { setAlert({ text, ok }); setTimeout(() => setAlert(null), 4000); }

  async function loadAll() {
    setLoading(true);
    try {
      const [langRes, statsRes, gCfgRes] = await Promise.all([
        fetch('/api/languages/config').then(r => r.json()),
        fetch('/api/stats').then(r => r.json()).catch(() => null),
        fetch('/api/settings/global').then(r => r.json()).catch(() => ({})),
      ]);
      setLanguages(Array.isArray(langRes) ? langRes : []);
      if (statsRes) setStats(statsRes);
      const gApi = gCfgRes?.api || 'deepseek';
      const gDefMdl = gApi === 'openrouter' ? 'openai/gpt-4o-mini' : 'deepseek-chat';
      setGlobalCfg({ api: gApi, model: gCfgRes?.model || gDefMdl });
    } catch { showMsg('Failed to load languages', false); }
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault(); setSaving(true);
    const known = KNOWN_LANGUAGES.find(l => l.code === form.code);
    const payload = {
      code: form.code, name: known?.name || form.code, flag: known?.flag || '',
      dir: known?.dir || 'ltr', api: form.api, model: form.model,
      countries: form.countries, enabled: form.enabled, prompt: form.prompt || '',
      word_cache: form.word_cache !== false,
    };
    try {
      const res = await fetch('/api/languages/config', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify(payload),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || 'Error adding'); }
      showMsg('Language added.', true); setShowAdd(false); setForm({ ...emptyForm }); loadAll();
    } catch (err: any) { showMsg(err.message || 'Error adding language', false); }
    setSaving(false);
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault(); if (!editLang) return; setSaving(true);
    const payload = { ...editLang, api: form.api, model: form.model, countries: form.countries, enabled: form.enabled, prompt: form.prompt || '', word_cache: form.word_cache !== false };
    try {
      const res = await fetch(`/api/languages/config/${editLang.code}`, {
        method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to save');
      showMsg('Language updated.', true); setEditLang(null); loadAll();
    } catch (err: any) { showMsg(err.message || 'Error saving', false); }
    setSaving(false);
  }

  function openEdit(lang: Language) {
    let countries: string[] = [];
    if (Array.isArray((lang as any).countries)) countries = (lang as any).countries;
    else if (typeof (lang as any).country_codes === 'string' && (lang as any).country_codes)
      countries = (lang as any).country_codes.split(',').map((s: string) => s.trim()).filter(Boolean);
    const userAllowedApi = getAllowedApi();
    const isRestricted = !isAdmin() && userAllowedApi !== 'all';
    const fallbackApi = isRestricted
      ? (isApiAllowed(globalCfg.api as 'deepseek'|'openrouter') ? globalCfg.api : (userAllowedApi === 'both' ? 'deepseek' : userAllowedApi))
      : globalCfg.api;
    let resolvedApi = lang.api || fallbackApi;
    if (isRestricted && !isApiAllowed(resolvedApi as 'deepseek'|'openrouter')) {
      resolvedApi = userAllowedApi === 'both' ? 'deepseek' : userAllowedApi;
    }
    const allowedMdls = isRestricted ? getAllowedModelsForApi(resolvedApi as 'deepseek'|'openrouter') : [];
    let resolvedMdl = lang.model || globalCfg.model;
    if (allowedMdls.length && !allowedMdls.includes(resolvedMdl)) resolvedMdl = allowedMdls[0];
    setForm({ code: lang.code, api: resolvedApi, model: resolvedMdl, countries, enabled: lang.enabled !== false, prompt: (lang as any).prompt || "", word_cache: lang.word_cache !== false });
    setEditLang(lang);
  }

  async function handleDelete(code: string) {
    if (!confirm(`Delete language "${code}"?`)) return;
    try {
      const res = await fetch(`/api/languages/config/${code}`, {
        method: 'DELETE', headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('bt_token') || '') },
      });
      if (!res.ok) throw new Error('Failed');
      showMsg(`Language "${code}" deleted.`, true); loadAll();
    } catch (err: any) { showMsg(err.message || 'Error deleting', false); }
  }

  async function toggleEnabled(lang: Language) {
    try {
      await fetch(`/api/languages/config/${lang.code}`, {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ ...lang, enabled: !lang.enabled }),
      });
      loadAll();
    } catch { showMsg('Error updating', false); }
  }

  const total = stats?.total_posts || 0;
  const addedCodes = languages.map(l => l.code);
  const availableToAdd = KNOWN_LANGUAGES.filter(l => !addedCodes.includes(l.code));
  const selectedKnown = KNOWN_LANGUAGES.find(l => l.code === form.code);

  return (
    <Shell>
      <Alert msg={alert} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={D.pageTitle}>Languages</h1>
          <p style={D.pageSub}>Manage translation languages and AI configuration.</p>
        </div>
        <button style={D.btnPrimary} onClick={() => { setForm({ ...emptyForm }); setShowAdd(true); }}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1={12} y1={5} x2={12} y2={19}/><line x1={5} y1={12} x2={19} y2={12}/></svg>
          Add Language
        </button>
      </div>

      {loading ? (
        <div style={{ ...D.card, padding: 40, textAlign: 'center', color: D.text3 }}>Loading languages...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {languages.map(lang => {
            const count = stats?.by_language?.[lang.code] ?? 0;
            const pct   = total > 0 ? Math.round((count / total) * 100) : 0;
            const barClr = pct === 100 ? '#10b981' : pct > 0 ? '#004D42' : '#e2e8f0';
            const countries = Array.isArray(lang.countries) ? lang.countries : [];
            return (
              <div key={lang.code} className="bt-card-hover" style={{ ...D.card, transition: 'all 0.15s ease', padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <FlagImg flag={lang.flag} size={22} />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: '600', color: D.text1 }}>{lang.name}</div>
                      <div style={{ fontSize: 11, color: D.text3, fontFamily: 'monospace' }}>{lang.code.toUpperCase()}</div>
                    </div>
                  </div>
                  <button onClick={() => toggleEnabled(lang)} style={{
                    fontSize: 11, fontWeight: '600', padding: '4px 10px', borderRadius: 99, cursor: 'pointer', border: 'none',
                    background: lang.enabled !== false ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.08)',
                    color: lang.enabled !== false ? '#059669' : '#dc2626',
                  }}>
                    <span style={{ fontSize: 8, marginRight: 4 }}>●</span>{lang.enabled !== false ? 'Enabled' : 'Disabled'}
                  </button>
                </div>

                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: 12, color: D.text3 }}>{count.toLocaleString()} / {total.toLocaleString()} pages</span>
                    <span style={{ fontSize: 12, fontWeight: '700', color: pct === 100 ? '#10b981' : D.brand }}>{pct}%</span>
                  </div>
                  <div style={{ background: '#e2e8f0', borderRadius: 99, height: 6, overflow: 'hidden' }}>
                    <div style={{ background: barClr, height: 6, borderRadius: 99, width: pct + '%', transition: 'width 0.5s ease' }} />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                  {lang.api && (
                    <span style={{ fontSize: 11, padding: '2px 7px', background: 'rgba(0,77,66,0.08)', border: '1px solid rgba(0,77,66,0.15)', borderRadius: 4, color: D.brand }}>
                      {lang.api === 'openrouter' ? 'OpenRouter' : 'DeepSeek'}
                    </span>
                  )}
                  {lang.model && (
                    <span style={{ fontSize: 11, padding: '2px 7px', background: '#f1f5f9', border: `1px solid ${D.border}`, borderRadius: 4, color: D.text3 }}>{lang.model}</span>
                  )}
                </div>

                {countries.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                    {countries.map(cc => {
                      const co = COUNTRY_OPTIONS.find(x => x.code === cc);
                      return (
                        <span key={cc} title={co?.name || cc} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '2px 6px', borderRadius: 3, background: '#f1f5f9', border: `1px solid ${D.border}`, color: D.text2 }}>
                          <span className={'fi fi-' + cc.toLowerCase()} style={{ fontSize: 10 }} />
                          {cc}
                        </span>
                      );
                    })}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, paddingTop: 10, borderTop: `1px solid ${D.border}` }}>
                  <button onClick={() => openEdit(lang)} style={{ ...D.btnSecondary, flex: 1, fontSize: 12, padding: '6px 12px', justifyContent: 'center' }}>Edit</button>
                  <button onClick={() => handleDelete(lang.code)} style={{ ...D.btnDanger, fontSize: 12, padding: '6px 12px' }}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Language Modal */}
      {showAdd && (
        <div className="bt-overlay" onClick={e => { if (e.target === e.currentTarget) setShowAdd(false); }}>
          <div className="bt-modal" style={{ maxWidth: 520 }}>
            <h2 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 700, color: D.text1 }}>Add Language</h2>
            <form onSubmit={handleAdd}>
              <div style={{ marginBottom: 16 }}>
                <label style={D.label}>Select Language *</label>
                <select className="bt-input-focus" style={{ ...D.select, width: '100%' }}
                  value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} required>
                  <option value="">Choose a language...</option>
                  {availableToAdd.map(l => (
                    <option key={l.code} value={l.code}>{l.flag} {l.name} ({l.code})</option>
                  ))}
                </select>
                {selectedKnown && (
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(0,77,66,0.06)', borderRadius: 6, border: '1px solid rgba(0,77,66,0.15)' }}>
                    <FlagImg flag={selectedKnown.flag} size={18} />
                    <span style={{ fontSize: 13, color: D.text1, fontWeight: '500' }}>{selectedKnown.name}</span>
                    <span style={{ fontSize: 11, color: D.text3, marginLeft: 4 }}>{selectedKnown.dir === 'rtl' ? 'RTL' : 'LTR'}</span>
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={D.label}>Countries (for geo-detection)</label>
                <CountryMultiSelect value={form.countries} onChange={countries => setForm(f => ({ ...f, countries }))} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px', marginBottom: 16 }}>
                <div>
                  <label style={D.label}>API Engine</label>
                  <select className="bt-input-focus" style={{ ...D.select, width: '100%' }}
                    value={form.api} onChange={e => setForm(f => ({ ...f, api: e.target.value, model: '' }))}>
                    <option value="">Default (Global)</option>
                    {(isAdmin() || isApiAllowed('deepseek')) && <option value="deepseek">DeepSeek</option>}
                    {(isAdmin() || isApiAllowed('openrouter')) && <option value="openrouter">OpenRouter</option>}
                  </select>
                </div>
                {form.api && (
                  <div>
                    <label style={D.label}>Model</label>
                    <ModelSelect api={form.api} value={form.model} includeDefault={true}
                      onChange={model => setForm(f => ({ ...f, model }))} style={{ ...D.select, width: '100%' }} />
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 16 }}>
                <PromptBox
                  label="Custom Prompt (optional)"
                  value={form.prompt || ''}
                  onChange={v => setForm(f => ({ ...f, prompt: v }))}
                  rows={4}
                  autoLoadDefault={true}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} style={{ accentColor: D.brand, width: 15, height: 15 }} />
                  <span style={{ fontSize: 13, color: D.text2 }}>Enable this language</span>
                </label>
              </div>

              <div style={{ marginBottom: 20, padding: '10px 12px', background: 'rgba(0,77,66,0.04)', border: '1px solid rgba(0,77,66,0.12)', borderRadius: 8 }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.word_cache !== false} onChange={e => setForm(f => ({ ...f, word_cache: e.target.checked }))} style={{ accentColor: D.brand, width: 15, height: 15, marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: D.text1 }}>Use shared word cache</span>
                    <div style={{ fontSize: 11, color: D.text3, marginTop: 2 }}>When enabled, already-translated words are reused across pages. Disable for languages like Russian, Polish, German where word endings change by grammar context.</div>
                  </div>
                </label>
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" style={D.btnSecondary} onClick={() => setShowAdd(false)}>Cancel</button>
                <button type="submit" style={{ ...D.btnPrimary, opacity: saving ? 0.6 : 1 }} disabled={saving || !form.code}>
                  {saving ? 'Adding...' : 'Add Language'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Language Modal */}
      {editLang && (
        <div className="bt-overlay" onClick={e => { if (e.target === e.currentTarget) setEditLang(null); }}>
          <div className="bt-modal" style={{ maxWidth: 520 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <FlagImg flag={editLang.flag} size={24} />
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: D.text1 }}>Edit {editLang.name}</h2>
            </div>
            <form onSubmit={handleEdit}>
              <div style={{ marginBottom: 16 }}>
                <label style={D.label}>Countries (for geo-detection)</label>
                <CountryMultiSelect value={form.countries} onChange={countries => setForm(f => ({ ...f, countries }))} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px', marginBottom: 16 }}>
                <div>
                  <label style={D.label}>API Engine</label>
                  <select className="bt-input-focus" style={{ ...D.select, width: '100%' }}
                    value={form.api} onChange={e => setForm(f => ({ ...f, api: e.target.value, model: '' }))}>
                    <option value="">Default (Global)</option>
                    {(isAdmin() || isApiAllowed('deepseek')) && <option value="deepseek">DeepSeek</option>}
                    {(isAdmin() || isApiAllowed('openrouter')) && <option value="openrouter">OpenRouter</option>}
                  </select>
                </div>
                {form.api && (
                  <div>
                    <label style={D.label}>Model</label>
                    <ModelSelect api={form.api} value={form.model} includeDefault={true}
                      onChange={model => setForm(f => ({ ...f, model }))} style={{ ...D.select, width: '100%' }} />
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 16 }}>
                <PromptBox
                  label="Custom Prompt (optional)"
                  value={form.prompt || ''}
                  onChange={v => setForm(f => ({ ...f, prompt: v }))}
                  rows={4}
                  autoLoadDefault={true}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} style={{ accentColor: D.brand, width: 15, height: 15 }} />
                  <span style={{ fontSize: 13, color: D.text2 }}>Language enabled</span>
                </label>
              </div>

              <div style={{ marginBottom: 20, padding: '10px 12px', background: 'rgba(0,77,66,0.04)', border: '1px solid rgba(0,77,66,0.12)', borderRadius: 8 }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.word_cache !== false} onChange={e => setForm(f => ({ ...f, word_cache: e.target.checked }))} style={{ accentColor: D.brand, width: 15, height: 15, marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: D.text1 }}>Use shared word cache</span>
                    <div style={{ fontSize: 11, color: D.text3, marginTop: 2 }}>When enabled, already-translated words are reused across pages. Disable for languages like Russian, Polish, German where word endings change by grammar context.</div>
                  </div>
                </label>
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" style={D.btnSecondary} onClick={() => setEditLang(null)}>Cancel</button>
                <button type="submit" style={{ ...D.btnPrimary, opacity: saving ? 0.6 : 1 }} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Shell>
  );
}
