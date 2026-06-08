'use client';
import { useState, useEffect } from 'react';

export interface Model { id: string; name: string; }

export const DEEPSEEK_MODELS: Model[] = [
  { id: 'deepseek-chat',     name: 'DeepSeek Chat (V3)' },
  { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner (R1)' },
];

export function useModels(api: string) {
  const [models,  setModels]  = useState<Model[]>(api === 'deepseek' ? DEEPSEEK_MODELS : []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (api === 'deepseek') { setModels(DEEPSEEK_MODELS); return; }
    if (api === 'openrouter') {
      setLoading(true);
      fetch('/api/models?api=openrouter')
        .then(r => r.json())
        .then(d => setModels(d.models || []))
        .catch(() => setModels([]))
        .finally(() => setLoading(false));
    }
  }, [api]);

  return { models, loading };
}

export function ModelSelect({
  api, value, onChange, style, includeDefault = false, defaultLabel = 'Default (Global)',
}: {
  api: string;
  value: string;
  onChange: (v: string) => void;
  style?: React.CSSProperties;
  includeDefault?: boolean;
  defaultLabel?: string;
}) {
  const { models, loading } = useModels(api);
  return (
    <select value={value} onChange={e => onChange(e.target.value)} disabled={loading}
      style={{ border: '1px solid #ddd', borderRadius: 6, padding: '5px 10px', fontSize: 13, background: '#fff', cursor: loading ? 'wait' : 'pointer', ...style }}>
      {includeDefault && <option value="">{loading ? 'Loading…' : defaultLabel}</option>}
      {!includeDefault && loading && <option value="">Loading models…</option>}
      {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
    </select>
  );
}
