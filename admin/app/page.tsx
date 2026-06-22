'use client';
import { useEffect, useState } from 'react';
import { useLanguages, FlagImg } from './lib/useLanguages';
import Shell, { D, Pill } from './components/Shell';
import { getPerms, isAdmin } from './lib/perms';

interface Stats {
  total_pages: number;
  translated_count: number;
  pending_count: number;
  by_language: Record<string, number>;
}

interface UserStats {
  total_pages: number;
  lang_count: number;
  translated_count: number;
  pending_count: number;
}

function RefreshIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  );
}

function StatCard({ label, value, icon, accent }: { label: string; value: string | number; icon: React.ReactNode; accent: string; }) {
  return (
    <div style={{ ...D.card, display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0, background: `${accent}18`, border: `1px solid ${accent}30`, display: 'grid', placeItems: 'center' }}>{icon}</div>
      <div>
        <div style={{ fontSize: 26, fontWeight: '700', color: D.text1, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 12, color: D.text3, marginTop: 3 }}>{label}</div>
      </div>
    </div>
  );
}

const IcPages = () => <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth={1.8} strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
const IcLangs = () => <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth={1.8} strokeLinecap="round"><circle cx={12} cy={12} r={10}/><line x1={2} y1={12} x2={22} y2={12}/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>;
const IcDone  = () => <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth={1.8} strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>;
const IcClock = () => <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth={1.8} strokeLinecap="round"><circle cx={12} cy={12} r={10}/><polyline points="12 6 12 12 16 14"/></svg>;

const QA_ITEMS = [
  { label: 'View Pages', href: '/pages',    primary: true  },
  { label: 'Translate',  href: '/translate', primary: false },
  { label: 'Languages',  href: '/languages', primary: false },
  { label: 'Reports',    href: '/reports',   primary: false },
];

function getUserId(): string {
  try {
    const tk = localStorage.getItem('bt_token') || '';
    const b = tk.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const pp = JSON.parse(atob(b.padEnd(b.length + (4 - b.length % 4) % 4, '=')));
    return pp.userId || pp.id || '';
  } catch { return ''; }
}

export default function Dashboard() {
  const { languages } = useLanguages();
  const [stats,     setStats]     = useState<Stats | null>(null);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [status,    setStatus]    = useState({ wp: false, deepseek: false, openrouter: false });
  const [loading,   setLoading]   = useState(true);

  const _admin = isAdmin();
  const _perms = getPerms();

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    try {
      if (_admin) {
        // Admin: fetch global stats
        const res = await fetch('/api/stats');
        if (res.ok) setStats(await res.json());
        checkStatus();
      } else {
        // Regular user: fetch user-specific stats
        const userId = getUserId();
        if (userId) {
          const token = typeof window !== 'undefined' ? (localStorage.getItem('bt_token') || '') : '';
          const activeSite = typeof window !== 'undefined' ? (localStorage.getItem('bt_active_site') || '') : '';
          const qs = activeSite ? `&env=${encodeURIComponent(activeSite)}` : '';
          const res = await fetch(`/api/user-stats?user_id=${userId}${qs}`, {
            headers: token ? { Authorization: 'Bearer ' + token } : {},
          });
          if (res.ok) {
            const data: UserStats = await res.json();
            setUserStats(data);
          }
        }
        // Also fetch global stats as fallback
        const res2 = await fetch('/api/stats');
        if (res2.ok) setStats(await res2.json());
      }
    } catch {
      // keep nulls
    } finally {
      setLoading(false);
    }
  }

  async function checkStatus() {
    try {
      const d = await fetch('/api/health').then(r => r.json());
      setStatus({ wp: d.wordpress === true || d.wp === true, deepseek: d.deepseek === true, openrouter: d.openrouter === true });
    } catch {}
  }

  // ── Values shown in cards ──────────────────────────────────────────────────
  let displayPages:      string | number = '—';
  let displayLangs:      string | number = '—';
  let displayTranslated: string | number = '—';
  let displayPending:    string | number = '—';

  if (!loading) {
    if (_admin) {
      // Admin sees global numbers
      const total      = stats?.total_pages      ?? 0;
      const translated = stats?.translated_count ?? 0;
      const pending    = stats?.pending_count    ?? 0;
      displayPages      = total.toLocaleString();
      displayLangs      = languages.length || 10;
      displayTranslated = translated.toLocaleString();
      displayPending    = pending.toLocaleString();
    } else {
      // Regular user sees their own numbers
      if (userStats) {
        displayPages      = userStats.total_pages.toLocaleString();
        displayLangs      = userStats.lang_count;
        displayTranslated = userStats.translated_count.toLocaleString();
        displayPending    = userStats.pending_count.toLocaleString();
      } else {
        // Fallback if user-stats endpoint failed: use perms + global total
        const langCount = _perms.languages && _perms.languages.length > 0 ? _perms.languages.length : 10;
        displayPages      = (stats?.total_pages ?? 0).toLocaleString();
        displayLangs      = langCount;
        displayTranslated = '0';
        displayPending    = ((stats?.total_pages ?? 0) * langCount).toLocaleString();
      }
    }
  }

  // Admin-only progress bar
  const adminTotal      = stats?.total_pages      ?? 0;
  const adminTranslated = stats?.translated_count ?? 0;
  const pct = adminTotal > 0 ? Math.round((adminTranslated / (adminTotal * 10)) * 100) : 0;

  return (
    <Shell>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={D.pageTitle}>Dashboard</h1>
          <p style={D.pageSub}>Translation system overview</p>
        </div>
        {_admin && (
          <button onClick={fetchAll} className="bt-btn-secondary" style={D.btnSecondary}>
            <RefreshIcon /> Refresh
          </button>
        )}
      </div>

      {/* Top 4 stat cards — user-specific for regular users */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 24 }}>
        <StatCard label="Total Pages"  value={displayPages}      icon={<IcPages />} accent="#3b82f6" />
        <StatCard label="Languages"    value={displayLangs}      icon={<IcLangs />} accent="#8b5cf6" />
        <StatCard label="Translated"   value={displayTranslated} icon={<IcDone />}  accent="#10b981" />
        <StatCard label="Pending"      value={displayPending}    icon={<IcClock />} accent="#f59e0b" />
      </div>

      {/* Admin-only sections */}
      {_admin && (
        <>
          <div style={{ ...D.cardLg, marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 14, fontWeight: '600', color: D.text1 }}>Overall Translation Progress</span>
              <span style={{ fontSize: 14, fontWeight: '700', color: D.brand }}>{pct}%</span>
            </div>
            <div style={{ background: '#e2e8f0', borderRadius: 99, height: 8, overflow: 'hidden' }}>
              <div style={{ height: 8, borderRadius: 99, width: pct + '%', background: 'linear-gradient(90deg, #004D42, #00897B)', transition: 'width 0.6s ease' }} />
            </div>
            <div style={{ fontSize: 12, color: D.text3, marginTop: 8 }}>
              {adminTranslated.toLocaleString()} of {(adminTotal * 10).toLocaleString()} page-language combinations translated
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div style={D.cardLg}>
              <div style={{ fontSize: 14, fontWeight: '600', color: D.text1, marginBottom: 18 }}>Progress By Language</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {languages.map(lang => {
                  const count = stats?.by_language?.[lang.code] ?? 0;
                  const lPct  = adminTotal > 0 ? Math.round((count / adminTotal) * 100) : 0;
                  const clr   = lPct === 100 ? '#10b981' : lPct > 0 ? '#004D42' : '#e2e8f0';
                  return (
                    <div key={lang.code}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, alignItems: 'center' }}>
                        <span style={{ fontSize: 13, color: D.text2, display: 'flex', alignItems: 'center', gap: 7 }}>
                          <FlagImg flag={lang.flag} size={16} /> {lang.name}
                        </span>
                        <span style={{ fontSize: 11, fontWeight: '600', color: lPct === 100 ? '#10b981' : D.text3 }}>{lPct}%</span>
                      </div>
                      <div style={{ background: '#e2e8f0', borderRadius: 99, height: 5 }}>
                        <div style={{ background: clr, height: 5, borderRadius: 99, width: lPct + '%', transition: 'width 0.5s ease' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={D.cardLg}>
                <div style={{ fontSize: 14, fontWeight: '600', color: D.text1, marginBottom: 14 }}>Quick Actions</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {QA_ITEMS.map(a => (
                    <a key={a.href} href={a.href} style={{
                      display: 'block', textAlign: 'center', textDecoration: 'none',
                      padding: '10px 12px', borderRadius: 7, fontSize: 13, fontWeight: '500',
                      background: a.primary ? D.brand : '#f8fafc',
                      color: a.primary ? '#fff' : D.text2,
                      border: `1px solid ${a.primary ? 'transparent' : D.border}`,
                    }}>{a.label}</a>
                  ))}
                </div>
              </div>
              <div style={D.cardLg}>
                <div style={{ fontSize: 14, fontWeight: '600', color: D.text1, marginBottom: 14 }}>System Status</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[
                    { label: 'WordPress Api', ok: status.wp },
                    { label: 'Deepseek Ai',   ok: status.deepseek },
                    { label: 'Openrouter',    ok: status.openrouter },
                  ].map(s => (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13, color: D.text2 }}>{s.label}</span>
                      <Pill ok={s.ok} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}
