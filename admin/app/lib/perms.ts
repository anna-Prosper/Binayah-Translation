// Reads user permissions from JWT in localStorage — synchronously, no API call needed
// Used to set DEFAULT state before any data loads

export interface UserPerms {
  role: string;
  hide_modules: string[];
  languages: string[];
  post_types: string[];
  api: string;               // 'all' | 'deepseek' | 'openrouter' | 'both'
  models: string[];          // legacy field — kept for backward compat
  deepseek_models: string[]; // [] = all deepseek models allowed
  openrouter_models: string[]; // [] = all openrouter models allowed
}

const DS_IDS = ['deepseek-chat', 'deepseek-reasoner'];

function readPerms(): UserPerms | null {
  if (typeof window === 'undefined') return null;
  try {
    const token = localStorage.getItem('bt_token') ||
      (document.cookie.match(/(?:^|;\s*)bt_token=([^;]*)/) || [])[1] || '';
    if (!token) return null;
    const b = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const p = JSON.parse(atob(b.padEnd(b.length + (4 - b.length % 4) % 4, '=')));
    const perms = p.permissions || {};
    return {
      role:              p.role              || 'user',
      hide_modules:      perms.hide_modules  || [],
      languages:         perms.languages     || [],
      post_types:        perms.post_types    || [],
      api:               perms.api           || 'all',
      models:            perms.models        || [],
      deepseek_models:   perms.deepseek_models   || [],
      openrouter_models: perms.openrouter_models  || [],
    };
  } catch { return null; }
}

export function getPerms(): UserPerms {
  return readPerms() || {
    role: 'user', hide_modules: [], languages: [], post_types: [],
    api: 'all', models: [], deepseek_models: [], openrouter_models: [],
  };
}

export function isAdmin():             boolean  { const p = readPerms(); return !p || p.role === 'superadmin'; }
export function getAllowedLangs():     string[] { const p = getPerms(); if (isAdmin() || !p.languages.length) return []; return p.languages; }
export function getAllowedPostTypes(): string[] { const p = getPerms(); if (isAdmin() || !p.post_types.length) return []; return p.post_types; }
export function getAllowedApi():       string   { const p = getPerms(); if (isAdmin()) return 'all'; return p.api || 'all'; }
export function getAllowedModels():    string[] { const p = getPerms(); if (isAdmin() || !p.models.length) return []; return p.models; }
export function isModuleHidden(m: string): boolean { const p = getPerms(); return p.hide_modules.includes(m); }

// Check if a specific API is allowed for the current user
export function isApiAllowed(api: 'deepseek' | 'openrouter'): boolean {
  if (isAdmin()) return true;
  const ua = getAllowedApi();
  return ua === 'all' || ua === 'both' || ua === api;
}

// Get allowed models for a specific API — handles both old flat models[] and new per-api fields
export function getAllowedModelsForApi(api: 'deepseek' | 'openrouter'): string[] {
  const p = getPerms();
  if (isAdmin()) return [];

  if (api === 'deepseek') {
    // New format
    if (p.deepseek_models.length > 0) return p.deepseek_models;
    // Backward compat: old flat models[] — extract deepseek IDs
    if (p.models.length > 0) {
      const filtered = p.models.filter(m => DS_IDS.includes(m));
      if (filtered.length > 0) return filtered;
    }
    return []; // all deepseek models allowed
  }

  if (api === 'openrouter') {
    // New format
    if (p.openrouter_models.length > 0) return p.openrouter_models;
    // Backward compat: old flat models[] — extract non-deepseek IDs
    if (p.models.length > 0) {
      const filtered = p.models.filter(m => !DS_IDS.includes(m));
      if (filtered.length > 0) return filtered;
    }
    return []; // all openrouter models allowed
  }

  return [];
}

// Get default language — first allowed or 'ar'
export function defaultLang(): string {
  const allowed = getAllowedLangs();
  return allowed.length ? allowed[0] : 'ar';
}

// Get default API — deepseek for unrestricted/both, otherwise user's assigned API
export function defaultApi(): string {
  const api = getAllowedApi();
  if (api === 'all' || api === 'both') return 'deepseek';
  return api;
}

// Get default model for the user's default API
export function defaultModel(): string {
  const api = defaultApi();
  const models = getAllowedModelsForApi(api as 'deepseek' | 'openrouter');
  return models.length ? models[0] : '';
}

// Filter a list to only allowed values (empty allowed = all ok)
export function filterAllowed<T extends { code?: string; slug?: string; id?: string }>(
  items: T[], allowed: string[], key: 'code' | 'slug' | 'id' = 'code'
): T[] {
  if (!allowed.length) return items;
  return items.filter(i => allowed.includes((i as any)[key] || ''));
}
