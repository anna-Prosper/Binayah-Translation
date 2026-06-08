'use client';
import { useEffect, useState } from 'react';
import { D } from './Shell';

interface Props {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  rows?: number;
  autoLoadDefault?: boolean; // fetch and pre-fill with default template
}

let _defaultPrompt = ''; // module-level cache

async function fetchDefault(): Promise<string> {
  if (_defaultPrompt) return _defaultPrompt;
  try {
    const d = await fetch('/api/translate/default-prompt').then(r => r.json());
    _defaultPrompt = d.template || '';
    return _defaultPrompt;
  } catch { return ''; }
}

export default function PromptBox({ value, onChange, label, rows = 6, autoLoadDefault = false }: Props) {
  const [defaultText, setDefaultText] = useState('');

  useEffect(() => {
    if (autoLoadDefault) {
      fetchDefault().then(t => setDefaultText(t));
    }
  }, [autoLoadDefault]);

  // When autoLoadDefault is on AND value is empty → show default as the value
  const displayValue = value;
  const placeholder  = defaultText ||
    'Leave blank to use the default prompt.\n\nExample:\nYou are a professional translator. Translate to {language}.\n- Return only translated text.\n- Preserve HTML tags.';

  return (
    <div>
      {label && <label style={D.label}>{label}</label>}
      <textarea
        value={displayValue}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        style={{
          ...D.input,
          resize: 'vertical',
          fontFamily: '"SF Mono","Fira Code",monospace',
          fontSize: 12,
          lineHeight: 1.6,
          minHeight: rows * 22,
        }}
      />
      <p style={{ margin: '5px 0 0', fontSize: 11, color: '#94a3b8', lineHeight: 1.5, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
        <span>Use <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3 }}>{'{language}'}</code> — replaced with target language name automatically.</span>
        {value && value.trim() && (
          <button
            type="button"
            onClick={() => onChange('')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 11, padding: 0, textDecoration: 'underline' }}
          >
            Reset to default
          </button>
        )}
        {autoLoadDefault && !value.trim() && defaultText && (
          <button
            type="button"
            onClick={() => onChange(defaultText)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#004D42', fontSize: 11, padding: 0, textDecoration: 'underline' }}
          >
            Load default to edit
          </button>
        )}
      </p>
    </div>
  );
}
