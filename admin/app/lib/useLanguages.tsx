'use client';
import { useEffect, useState } from 'react';

export interface Language {
  code: string; name: string; native: string; flag: string;
  dir: string; enabled: boolean; api: string; countries?: string[];
}

function emojiToCode(emoji: string): string {
  const pts = [...emoji];
  if (pts.length < 2) return '';
  return pts.map(c => String.fromCharCode((c.codePointAt(0) ?? 0x1F1E6) - 0x1F1E6 + 65)).join('').toLowerCase();
}

export function FlagImg({ flag, size = 20 }: { flag?: string; size?: number }) {
  if (!flag) return null;
  const code = flag.length <= 3 ? flag.toLowerCase() : emojiToCode(flag);
  if (!code) return null;
  return <span className={`fi fi-${code}`} style={{ fontSize: size, lineHeight: 1, display:'inline-block', verticalAlign:'middle', borderRadius:2, flexShrink:0 }} />;
}

let _cache: Language[] | null = null;
let _promise: Promise<Language[]> | null = null;

function fetchLanguages(): Promise<Language[]> {
  if (_cache) return Promise.resolve(_cache);
  if (!_promise) {
    _promise = fetch('/api/languages/config')
      .then(r => r.json())
      .then((data: Language[]) => { _cache = Array.isArray(data) ? data.filter(l => l.enabled !== false) : []; return _cache!; })
      .catch(() => { _promise = null; return []; });
  }
  return _promise;
}

export function useLanguages() {
  const [languages, setLanguages] = useState<Language[]>(_cache ?? []);
  const [loading, setLoading] = useState(!_cache);
  useEffect(() => {
    if (_cache) { setLanguages(_cache); setLoading(false); return; }
    fetchLanguages().then(langs => { setLanguages(langs); setLoading(false); });
  }, []);
  return { languages, loading };
}
