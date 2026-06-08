'use client';
import { useState } from 'react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError('');
    try {
      const res  = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(username.trim() ? { username: username.trim(), password } : { password }),
      });
      const data = await res.json();
      if (data.token) {
        document.cookie = 'bt_token=' + data.token + '; path=/; max-age=' + (7 * 24 * 3600) + '; SameSite=Strict';
        localStorage.setItem('bt_token', data.token);
        try {
          const parts = data.token.split('.');
          const pad = parts[1].replace(/-/g,'+').replace(/_/g,'/');
          const payload = JSON.parse(atob(pad.padEnd(pad.length + (4-pad.length%4)%4, '=')));
          localStorage.setItem('bt_user', JSON.stringify(payload));
        } catch {}
        window.location.href = '/';
      } else { setError(data.error || 'Invalid password.'); }
    } catch { setError('Connection error. Please try again.'); }
    setLoading(false);
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#F4F6F8',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Segoe UI, Arial, sans-serif', padding: 20,
    }}>
      <div style={{
        background: '#fff', border: '1px solid #e2e8f0',
        borderRadius: 12, padding: '40px 36px',
        width: '100%', maxWidth: 400,
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-block', marginBottom: 16 }}>
            <img src="/favicon.jpg" alt="Binayah" style={{ width: 72, height: 72, borderRadius: 14, objectFit: 'cover', display: 'block' }} />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: '700', color: '#1a2332', margin: '0 0 6px' }}>Sign in</h1>
          <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>Binayah Translation Admin</p>
        </div>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: '600', color: '#4a5568', marginBottom: 7 }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Enter your username"
              autoFocus
              style={{
                width: '100%', padding: '11px 14px', borderRadius: 7,
                border: '1.5px solid #d1d9e0', background: '#fff',
                color: '#1a2332', fontSize: 14, outline: 'none',
                boxSizing: 'border-box' as const, fontFamily: 'inherit',
                transition: 'border-color 0.12s ease',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = '#004D42')}
              onBlur={e => (e.currentTarget.style.borderColor = '#d1d9e0')}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: '600', color: '#4a5568', marginBottom: 7 }}>
              Password
            </label>
            <input
              type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter admin password"
              required
              style={{
                width: '100%', padding: '11px 14px', borderRadius: 7,
                border: error ? '1px solid rgba(239,68,68,0.6)' : '1px solid #d1d9e0',
                background: '#fff', color: '#1a2332', fontSize: 14,
                outline: 'none', boxSizing: 'border-box',
                transition: 'border-color 0.12s ease',
              }}
            />
          </div>

          {error && (
            <div style={{
              padding: '10px 14px', borderRadius: 7, marginBottom: 16,
              background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
              color: '#dc2626', fontSize: 13,
            }}>✗ {error}</div>
          )}

          <button type="submit" disabled={loading || !password} style={{
            width: '100%', padding: '12px', borderRadius: 7, border: 'none',
            background: loading || !password ? '#e2e8f0' : '#004D42',
            color: loading || !password ? '#94a3b8' : '#fff',
            fontSize: 14, fontWeight: '600', cursor: loading || !password ? 'not-allowed' : 'pointer',
            transition: 'all 0.12s ease',
          }}>
            {loading ? 'Signing in…' : 'Sign in →'}
          </button>
        </form>

        <div style={{ textAlign: 'center', fontSize: 11, color: '#cbd5e1', marginTop: 24 }}>
          v1.0.0 · binayah.com
        </div>
      </div>
    </div>
  );
}
