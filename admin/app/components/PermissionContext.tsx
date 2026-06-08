'use client';
import React, { createContext, useContext, useEffect, useState } from 'react';

export interface UserPayload {
  userId: string;
  username: string;
  role: 'superadmin' | 'user';
  permissions: {
    modules: string[];
    languages: string[];
    post_types: string[];
    models: string[];
    deepseek_models?: string[];
    openrouter_models?: string[];
    api?: string;
    hide_modules?: string[];
  };
}

interface Ctx {
  user: UserPayload | null;
  refresh: () => void;
}

const PermCtx = createContext<Ctx>({ user: null, refresh: () => {} });

function decode(): UserPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const token = localStorage.getItem('bt_token');
    if (!token) return null;
    const b = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    const p = JSON.parse(atob(b.padEnd(b.length+(4-b.length%4)%4,'=')));
    if (!p.userId || !p.role) return null;
    if (!p.permissions) p.permissions = { modules:[], languages:[], post_types:[], models:[] };
    return p as UserPayload;
  } catch { return null; }
}

export function PermissionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserPayload | null>(() => decode());
  const refresh = () => setUser(decode());

  // Refresh token from server (gets latest permissions without re-login)
  async function refreshFromServer() {
    const token = typeof window !== 'undefined' ? localStorage.getItem('bt_token') : null;
    if (!token) return;
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': 'Bearer ' + token },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          localStorage.setItem('bt_token', data.token);
          setUser(decode());
        }
      }
    } catch {}
  }

  // Refresh on mount (picks up permission changes from superadmin)
  useEffect(() => {
    refreshFromServer();
  }, []);

  // Refresh whenever the tab gets focus (user switches back to tab)
  useEffect(() => {
    window.addEventListener('focus', refreshFromServer);
    return () => window.removeEventListener('focus', refreshFromServer);
  }, []);

  // Also refresh on localStorage change from another tab
  useEffect(() => {
    const handle = (e: StorageEvent) => {
      if (e.key === 'bt_token' || e.key === null) setUser(decode());
    };
    window.addEventListener('storage', handle);
    return () => window.removeEventListener('storage', handle);
  }, []);

  return <PermCtx.Provider value={{ user, refresh }}>{children}</PermCtx.Provider>;
}

export function usePermissions()                     { return useContext(PermCtx); }
export function isSuperAdmin(u: UserPayload | null)  { return u?.role === 'superadmin'; }
export function canModule(u: UserPayload | null, m: string) {
  if (!u) return false;
  if (u.role === 'superadmin') return true;
  return (u.permissions.modules || []).includes(m);
}
export function allowedLangs(u: UserPayload | null)      { if (!u || u.role==='superadmin') return []; return u.permissions.languages  || []; }
export function allowedPostTypes(u: UserPayload | null)  { if (!u || u.role==='superadmin') return []; return u.permissions.post_types  || []; }
export function allowedModels(u: UserPayload | null)     { if (!u || u.role==='superadmin') return []; return u.permissions.models      || []; }
