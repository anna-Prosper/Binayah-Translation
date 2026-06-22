'use client';
import { usePermissions, isSuperAdmin } from './PermissionContext';
import { isModuleHidden } from '../lib/perms';
import { usePathname } from 'next/navigation';
import { useState, useEffect, type ReactNode } from 'react';

const W = 240;
const BRAND = '#004D42';
const GOLD  = '#C8A951';

function Ic({ children }: { children: ReactNode }) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

const ICONS = {
  dashboard: <Ic><rect x={3} y={3} width={7} height={7} rx={1}/><rect x={14} y={3} width={7} height={7} rx={1}/><rect x={3} y={14} width={7} height={7} rx={1}/><rect x={14} y={14} width={7} height={7} rx={1}/></Ic>,
  pages:     <Ic><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></Ic>,
  translate: <Ic><path d="M2 5h7M5 2v3M6 10c0 3-1 5-3 7"/><path d="M16 3l5 19M16 3l-5 19M18 14h-4"/></Ic>,
  languages: <Ic><circle cx={12} cy={12} r={10}/><line x1={2} y1={12} x2={22} y2={12}/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></Ic>,
  reports:   <Ic><line x1={18} y1={20} x2={18} y2={10}/><line x1={12} y1={20} x2={12} y2={4}/><line x1={6} y1={20} x2={6} y2={14}/></Ic>,
  usage:     <Ic><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 6v6l4 2"/><circle cx={18} cy={6} r={4} fill="currentColor" fillOpacity={.15}/><line x1={18} y1={4} x2={18} y2={8}/><line x1={16} y1={6} x2={20} y2={6}/></Ic>,
  settings:  <Ic><circle cx={12} cy={12} r={3}/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></Ic>,
  progress:  <Ic><circle cx={12} cy={12} r={10}/><polyline points="10 15 12 17 16 13"/><line x1={12} y1={8} x2={12} y2={12}/></Ic>,
  users:     <Ic><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx={9} cy={7} r={4}/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></Ic>,
  logout:    <Ic><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1={21} y1={12} x2={9} y2={12}/></Ic>,
};

const NAV = [
  { label: 'Dashboard', href: '/',          icon: 'dashboard' },
  { label: 'Pages',     href: '/pages',     icon: 'pages'     },
  { label: 'Translate', href: '/translate', icon: 'translate' },
  { label: 'Languages', href: '/languages', icon: 'languages' },
  { label: 'Progress',  href: '/progress',  icon: 'progress'  },
  { label: 'Reports',   href: '/reports',   icon: 'reports'   },
  { label: 'Usage',     href: '/usage',     icon: 'usage'     },
  { label: 'Users',     href: '/users',     icon: 'users'     },
  { label: 'Settings',  href: '/settings',  icon: 'settings'  },
] as const;

export function logout() {
  try { localStorage.removeItem('bt_token'); } catch {}
  document.cookie = 'bt_token=; path=/; max-age=0; SameSite=Strict';
  window.location.href = '/login';
}

export const D = {
  bg:      '#F4F6F8',
  surface: '#ffffff',
  brand:   '#004D42',
  gold:    '#C8A951',
  border:  '#e2e8f0',
  border2: '#cbd5e1',
  text1:   '#111111',
  text2:   '#333333',
  text3:   '#666666',
  radius:  8,
  card: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: '20px 22px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  } as React.CSSProperties,
  cardLg: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: '22px 24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  } as React.CSSProperties,
  btnPrimary: {
    background: '#004D42',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    padding: '9px 18px',
    fontSize: 13,
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'opacity 0.12s ease',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontFamily: 'inherit',
  } as React.CSSProperties,
  btnSecondary: {
    background: '#ffffff',
    color: '#111111',
    border: '1px solid #d1d9e0',
    borderRadius: 6,
    padding: '9px 18px',
    fontSize: 13,
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'background 0.12s ease',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontFamily: 'inherit',
  } as React.CSSProperties,
  btnDanger: {
    background: '#ffffff',
    color: '#dc2626',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 6,
    padding: '9px 18px',
    fontSize: 13,
    fontWeight: '500',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontFamily: 'inherit',
  } as React.CSSProperties,
  input: {
    background: '#ffffff',
    border: '1px solid #d1d9e0',
    borderRadius: 6,
    color: '#111111',
    padding: '9px 12px',
    fontSize: 13,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
    transition: 'border-color 0.12s ease',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  select: {
    background: '#ffffff',
    border: '1px solid #d1d9e0',
    borderRadius: 6,
    color: '#111111',
    padding: '9px 12px',
    fontSize: 13,
    outline: 'none',
    cursor: 'pointer',
    transition: 'border-color 0.12s ease',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  label: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: '#333333',
    textTransform: 'capitalize' as const,
    marginBottom: 6,
    display: 'block',
  } as React.CSSProperties,
  pageTitle: {
    margin: '0 0 4px',
    fontSize: '20px',
    fontWeight: '700',
    color: '#111111',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  pageSub: { margin: '0 0 24px', fontSize: '13px', color: '#666666' } as React.CSSProperties,
};

export function Pill({ ok, labels }: { ok: boolean; labels?: [string, string] }) {
  const [t, f] = labels ?? ['Online', 'Offline'];
  return (
    <span style={{
      fontSize: 11, fontWeight: '600', padding: '3px 9px', borderRadius: 99,
      background: ok ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
      color: ok ? '#059669' : '#dc2626',
      border: `1px solid ${ok ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
    }}>
      <span style={{ marginRight: 4 }}>●</span>{ok ? t : f}
    </span>
  );
}

export function Alert({ msg }: { msg: { text: string; ok: boolean } | null }) {
  if (!msg) return null;
  const IcCheck = () => <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>;
  const IcX     = () => <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1={18} y1={6} x2={6} y2={18}/><line x1={6} y1={6} x2={18} y2={18}/></svg>;
  return (
    <div style={{
      padding: '11px 16px', borderRadius: 6, marginBottom: 16,
      background: msg.ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
      color: msg.ok ? '#059669' : '#dc2626',
      border: `1px solid ${msg.ok ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
      fontSize: 13, fontWeight: '500', display: 'flex', alignItems: 'center', gap: 8,
    }}>
      {msg.ok ? <IcCheck /> : <IcX />} {msg.text}
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname() ?? '/';
  const { user } = usePermissions();
  const _isAdmin = isSuperAdmin(user);
  const [hasMounted, setHasMounted] = useState(false);
  const [envInfo, setEnvInfo] = useState<{ active: string; sites: Record<string, { name: string; connected: boolean }> } | null>(null);
  const [envSwitching, setEnvSwitching] = useState(false);
  // Per-user site state (for non-superadmin users with site assignments)
  const [userSiteKeys, setUserSiteKeys] = useState<string[]>([]);
  const [userActiveSite, setUserActiveSite] = useState<string>('');

  useEffect(() => { setHasMounted(true); }, []);

  useEffect(() => {
    // Superadmin: fetch global env from server
    if (_isAdmin) {
      const token = typeof window !== 'undefined' ? localStorage.getItem('bt_token') : null;
      if (!token) return;
      fetch('/api/env', { headers: { Authorization: 'Bearer ' + token } })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setEnvInfo(d); })
        .catch(() => {});
      return;
    }
    // Regular user: read site assignments from JWT
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('bt_token') : '';
      if (!token) return;
      const b = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(b.padEnd(b.length + (4 - b.length % 4) % 4, '=')));
      const sites = (payload.permissions || {}).sites || {};
      const keys = Object.keys(sites);
      if (keys.length > 0) {
        setUserSiteKeys(keys);
        const stored = typeof window !== 'undefined' ? (localStorage.getItem('bt_active_site') || '') : '';
        setUserActiveSite(keys.includes(stored) ? stored : keys[0]);
      }
    } catch {}
  }, [_isAdmin]);

  async function switchEnv(target: string) {
    const token = typeof window !== 'undefined' ? localStorage.getItem('bt_token') : null;
    if (!token || envSwitching) return;
    setEnvSwitching(true);
    try {
      if (_isAdmin) {
        // Superadmin: global switch via API
        const r = await fetch('/api/env/switch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ env: target }),
        });
        if (r.ok) setEnvInfo(prev => prev ? { ...prev, active: target } : prev);
      } else {
        // Regular user: personal switch via localStorage
        localStorage.setItem('bt_active_site', target);
        setUserActiveSite(target);
        window.dispatchEvent(new CustomEvent('bt_site_changed', { detail: target }));
      }
    } finally { setEnvSwitching(false); }
  }

  // Determine what to show in env badge
  const showEnvBadge = _isAdmin ? !!envInfo : userSiteKeys.length > 0;
  const activeSiteKey = _isAdmin ? (envInfo?.active || '') : userActiveSite;
  const canSwitch = _isAdmin ? Object.keys(envInfo?.sites || {}).length > 1 : userSiteKeys.length > 1;
  const siteLabel = activeSiteKey === 'live' ? 'LIVE' : activeSiteKey === 'staging' ? 'STAGING' : activeSiteKey.toUpperCase();
  const nextSite  = _isAdmin
    ? (activeSiteKey === 'live' ? 'staging' : 'live')
    : userSiteKeys.find(k => k !== activeSiteKey) || '';

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: D.bg, fontFamily: '-apple-system, "Segoe UI", Arial, sans-serif', color: D.text1, fontSize: 13 }}>
      <aside style={{
        width: W, position: 'fixed', inset: '0 auto 0 0',
        background: BRAND, display: 'flex', flexDirection: 'column', zIndex: 50,
        boxShadow: '2px 0 12px rgba(0,77,66,0.25)',
      }}>
        <div style={{ padding: '20px 20px 14px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <img src="/logo.svg" alt="Binayah" style={{ height: 34, filter: 'brightness(0) invert(1)', objectFit: 'contain', display: 'block' }} />
        </div>
        {hasMounted && showEnvBadge && (
          <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 6, background: 'rgba(0,0,0,0.15)' }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: activeSiteKey === 'live' ? '#10b981' : '#f59e0b',
                boxShadow: activeSiteKey === 'live' ? '0 0 6px #10b981' : '0 0 6px #f59e0b',
              }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1 }}>
                {siteLabel}
              </span>
              {canSwitch ? (
                <button
                  onClick={() => switchEnv(nextSite)}
                  disabled={envSwitching}
                  style={{
                    fontSize: 10, padding: '2px 7px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.25)',
                    background: 'transparent', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                  }}>
                  {envSwitching ? '...' : 'Switch'}
                </button>
              ) : (
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>locked</span>
              )}
            </div>
          </div>
        )}
        <nav style={{ flex: 1, padding: '10px 10px', overflow: 'auto' }}>
          {NAV.filter(item => {
            if (!hasMounted) return true; // SSR/initial hydration: CSS handles hiding
            if (item.href === '/users' || item.href === '/settings') return _isAdmin;
            if (!_isAdmin && item.href !== '/') {
              const mod = item.href.slice(1);
              if (mod && isModuleHidden(mod)) return false;
            }
            return true;
          }).map(item => {
            const active = item.href === '/' ? path === '/' : path.startsWith(item.href);
            return (
              <a key={item.href} href={item.href}
                className={item.href==='/users'||item.href==='/settings'?'admin-only-nav':item.href==='/languages'?'lang-nav':''}
                style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px', borderRadius: 6, marginBottom: 2,
                textDecoration: 'none',
                background: active ? 'rgba(255,255,255,0.15)' : 'transparent',
                color: active ? '#ffffff' : 'rgba(255,255,255,0.7)',
                fontSize: 13.5,
                fontWeight: active ? '600' : '400',
                borderLeft: `3px solid ${active ? GOLD : 'transparent'}`,
                transition: 'all 0.12s ease',
              }}>
                <span style={{ display: 'flex', flexShrink: 0, opacity: active ? 1 : 0.75 }}>
                  {ICONS[item.icon as keyof typeof ICONS]}
                </span>
                {item.label}
              </a>
            );
          })}
        </nav>
        <div style={{ padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          {user && (
            <div style={{ padding: '8px 12px 10px', display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(200,169,81,0.2)', border: '1.5px solid rgba(200,169,81,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#C8A951', flexShrink: 0 }}>
                {user.username.charAt(0).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.username}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'capitalize' }}>{user.role === 'superadmin' ? 'Super Admin' : 'User'}</div>
              </div>
            </div>
          )}
          <button onClick={logout} style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            padding: '9px 12px', borderRadius: 6, border: 'none',
            background: 'transparent', color: 'rgba(255,255,255,0.5)', fontSize: 13,
            cursor: 'pointer', textAlign: 'left', transition: 'all 0.12s ease',
            fontFamily: 'inherit',
          }}>
            <span style={{ display: 'flex', flexShrink: 0 }}>{ICONS.logout}</span>
            Sign Out
          </button>
        </div>
      </aside>
      <main style={{ marginLeft: W, flex: 1, minWidth: 0, padding: '28px 32px' }}>
        {children}
      </main>
    </div>
  );
}
