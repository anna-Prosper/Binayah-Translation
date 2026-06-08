'use client';
import { useEffect, useState } from 'react';
import Shell, { D, Alert, Pill } from '../components/Shell';
import { ModelSelect } from '../lib/useModels';
import PromptBox from '../components/PromptBox';

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + (localStorage.getItem('bt_token') || ''),
  };
}

function KeyIcon() {
  return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>;
}
function CheckIcon() {
  return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>;
}
function TestIcon() {
  return <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>;
}

export default function SettingsPage() {

  const [deepseekKey,     setDeepseekKey]     = useState('');
  const [openrouterKey,   setOpenrouterKey]   = useState('');
  const [wpUrl,           setWpUrl]           = useState('');
  const [status,          setStatus]          = useState({ deepseek_set: false, openrouter_set: false });
  const [deepseekMasked,  setDeepseekMasked]  = useState('');
  const [openrouterMasked,setOpenrouterMasked]= useState('');
  const [msg,             setMsg]             = useState<{text:string;ok:boolean}|null>(null);
  const [testing,         setTesting]         = useState<string|null>(null);
  const [saving,          setSaving]          = useState(false);
  const [globalApi,       setGlobalApi]       = useState('deepseek');
  const [globalModel,     setGlobalModel]     = useState('deepseek-chat');
  const [globalPrompt,    setGlobalPrompt]    = useState('');
  const [promptSaving,    setPromptSaving]    = useState(false);
  const [globalSaving,    setGlobalSaving]    = useState(false);
  const [globalMsg,       setGlobalMsg]       = useState<{text:string;ok:boolean}|null>(null);

  function showMsg(t: string, ok: boolean) { setMsg({ text: t, ok }); setTimeout(() => setMsg(null), 5000); }

  async function loadStatus() {
    const fresh = await fetch('/api/settings').then(r => r.json()).catch(() => ({}));
    setWpUrl(fresh.wp_url || '');
    setStatus({ deepseek_set: !!fresh.deepseek_set, openrouter_set: !!fresh.openrouter_set });
    setDeepseekMasked(fresh.deepseek_masked || '');
    setOpenrouterMasked(fresh.openrouter_masked || '');
  }


  useEffect(() => {
    loadStatus();
    fetch('/api/settings/global').then(r => r.json()).then(d => {
      setGlobalApi(d.api || 'deepseek');
      setGlobalModel(d.model || 'deepseek-chat');
      setGlobalPrompt(d.prompt || '');
    }).catch(() => {});
  }, []);

  async function save() {
    if (!deepseekKey && !openrouterKey) { showMsg('Enter at least one key to save', false); return; }
    setSaving(true);
    const body: Record<string, string> = {};
    if (deepseekKey)   body.deepseek_key   = deepseekKey;
    if (openrouterKey) body.openrouter_key = openrouterKey;
    const d = await fetch('/api/settings', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }).then(r => r.json());
    if (d.success) {
      showMsg('Keys saved successfully!', true);
      setDeepseekKey(''); setOpenrouterKey('');
      await loadStatus();
    } else { showMsg('Failed to save', false); }
    setSaving(false);
  }

  async function removeKey(type: 'deepseek' | 'openrouter') {
    if (!confirm(`Remove the ${type === 'deepseek' ? 'DeepSeek' : 'OpenRouter'} API key?`)) return;
    const keyField = type === 'deepseek' ? 'deepseek_key' : 'openrouter_key';
    const d = await fetch('/api/settings', {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ [keyField]: '' }),
    }).then(r => r.json());
    if (d.success) {
      showMsg(`${type === 'deepseek' ? 'DeepSeek' : 'OpenRouter'} key removed.`, true);
      if (type === 'deepseek') setDeepseekKey('');
      else setOpenrouterKey('');
      await loadStatus();
    } else showMsg('Failed to remove key', false);
  }

  async function testKey(type: 'deepseek' | 'openrouter') {
    const key = type === 'deepseek' ? deepseekKey : openrouterKey;
    if (!key) { showMsg('Enter a key first, then click Test', false); return; }
    setTesting(type);
    const d = await fetch('/api/settings/test-' + type, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ key }) }).then(r => r.json());
    showMsg(d.ok ? `${type === 'deepseek' ? 'DeepSeek' : 'OpenRouter'} key is valid!` + (d.models ? ` (${d.models} models)` : '') : `${type} error: ${d.error}`, d.ok);
    setTesting(null);
  }

  async function saveGlobal() {
    setGlobalSaving(true);
    const d = await fetch('/api/settings/global', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ api: globalApi, model: globalModel }) }).then(r => r.json());
    setGlobalMsg(d.success ? { text: 'Global model saved!', ok: true } : { text: 'Failed to save', ok: false });
    setTimeout(() => setGlobalMsg(null), 4000);
    setGlobalSaving(false);
  }

  const SectionTitle = ({ children }: { children: string }) => (
    <div style={{ fontSize: 14, fontWeight: '600', color: D.text1, marginBottom: 4 }}>{children}</div>
  );

  function KeyField({
    label, value, onChange, placeholder, masked, isSet, type, onRemove, onTest, testLoading,
  }: {
    label: string; value: string; onChange: (v: string) => void; placeholder: string;
    masked: string; isSet: boolean; type: 'deepseek' | 'openrouter';
    onRemove: () => void; onTest: () => void; testLoading: boolean;
  }) {
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <SectionTitle>{label}</SectionTitle>
          <Pill ok={isSet} labels={['Connected', 'Not Set']} />
        </div>
        {isSet && masked && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#059669', marginBottom: 8, padding: '6px 10px', background: 'rgba(16,185,129,0.06)', borderRadius: 5, border: '1px solid rgba(16,185,129,0.15)' }}>
            <CheckIcon /> Current key: <code style={{ fontFamily: 'monospace', fontSize: 12, color: '#059669', fontWeight: '600' }}>{masked}</code>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: D.text3 }}><KeyIcon /></span>
            <input
              type="text"
              value={value}
              onChange={e => onChange(e.target.value)}
              placeholder={isSet ? 'Enter new key to replace...' : placeholder}
              className="bt-input-focus"
              style={{ ...D.input, paddingLeft: 32 }}
            />
          </div>
          <button onClick={onTest} disabled={!value || testLoading} style={{ ...D.btnSecondary, whiteSpace: 'nowrap', opacity: !value ? 0.4 : 1 }}>
            <TestIcon /> {testLoading ? 'Testing...' : 'Test'}
          </button>
          {isSet && (
            <button onClick={onRemove} style={{ ...D.btnDanger, whiteSpace: 'nowrap' }}>Remove</button>
          )}
        </div>
      </div>
    );
  }

  async function savePrompt() {
    setPromptSaving(true);
    try {
      await fetch('/api/settings/global', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ prompt: globalPrompt }),
      });
    } catch {}
    setPromptSaving(false);
  }

  return (
    <Shell>
      <h1 style={D.pageTitle}>Settings</h1>
      <p style={D.pageSub}>Configure API keys and default AI model</p>

      <Alert msg={msg} />

      {/* WordPress */}
      <div style={{ ...D.cardLg, marginBottom: 20 }}>
        <SectionTitle>WordPress Connection</SectionTitle>
        <p style={{ margin: '2px 0 12px', fontSize: 12, color: D.text3 }}>Connected WordPress site for fetching and saving translations</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#f8fafc', borderRadius: 6, border: `1px solid ${D.border}`, fontSize: 13, color: D.text2 }}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={D.text3} strokeWidth={2} strokeLinecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          <span style={{ flex: 1 }}>{wpUrl || '—'}</span>
          <Pill ok={!!wpUrl} labels={['Connected', 'Not Set']} />
        </div>
      </div>

      {/* Side-by-side: API Keys + Global AI Model */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>

        {/* Left: API Keys */}
        <div style={D.cardLg}>
          <SectionTitle>API Keys</SectionTitle>
          <p style={{ margin: '2px 0 16px', fontSize: 12, color: D.text3 }}>Keys are stored securely on the server and never exposed to the browser.</p>

          <KeyField
            label="DeepSeek API Key"
            value={deepseekKey}
            onChange={setDeepseekKey}
            placeholder="sk-..."
            masked={deepseekMasked}
            isSet={status.deepseek_set}
            type="deepseek"
            onRemove={() => removeKey('deepseek')}
            onTest={() => testKey('deepseek')}
            testLoading={testing === 'deepseek'}
          />

          <KeyField
            label="OpenRouter API Key"
            value={openrouterKey}
            onChange={setOpenrouterKey}
            placeholder="sk-or-v1-..."
            masked={openrouterMasked}
            isSet={status.openrouter_set}
            type="openrouter"
            onRemove={() => removeKey('openrouter')}
            onTest={() => testKey('openrouter')}
            testLoading={testing === 'openrouter'}
          />

          <button onClick={save} disabled={saving || (!deepseekKey && !openrouterKey)}
            style={{ ...D.btnPrimary, opacity: saving || (!deepseekKey && !openrouterKey) ? 0.5 : 1 }}>
            {saving ? 'Saving...' : 'Save Keys'}
          </button>
        </div>

        {/* Right: Global AI Model */}
        <div style={D.cardLg}>
          <SectionTitle>Global AI Model</SectionTitle>
          <p style={{ margin: '2px 0 16px', fontSize: 12, color: D.text3 }}>Default model used for all translations unless overridden per-language or per-page.</p>
          <Alert msg={globalMsg} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={D.label}>API Engine</label>
              <select value={globalApi} onChange={e => { setGlobalApi(e.target.value); setGlobalModel(''); }}
                style={{ ...D.select, width: '100%' }}>
                <option value="deepseek">DeepSeek AI</option>
                <option value="openrouter">OpenRouter</option>
              </select>
            </div>
            <div>
              <label style={D.label}>Model</label>
              <ModelSelect api={globalApi} value={globalModel} onChange={setGlobalModel} style={{ ...D.select, width: '100%' }} />
            </div>
            <div>
              <button onClick={saveGlobal} disabled={globalSaving} style={{ ...D.btnPrimary, opacity: globalSaving ? 0.5 : 1 }}>
                {globalSaving ? 'Saving...' : 'Save Model'}
              </button>

              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
                <PromptBox
                  label="Default Translation Prompt"
                  value={globalPrompt}
                  onChange={setGlobalPrompt}
                  rows={7}
                  autoLoadDefault={true}
                />
                <button
                  onClick={savePrompt}
                  disabled={promptSaving}
                  style={{ ...D.btnSecondary, marginTop: 10, opacity: promptSaving ? 0.6 : 1 }}>
                  {promptSaving ? 'Saving...' : 'Save Prompt'}
                </button>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 6, background: '#f8fafc', border: `1px solid ${D.border}`, fontSize: 12, color: D.text3 }}>
            Priority: Translate Page Config &rarr; Language Config &rarr; Global (this)
          </div>
        </div>

      </div>
    </Shell>
  );
}
