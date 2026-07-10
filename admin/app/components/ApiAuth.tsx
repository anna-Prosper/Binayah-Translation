'use client';
import { useEffect } from 'react';

/**
 * Attaches the stored JWT (bt_token) to every same-origin `/api/*` request.
 * Many call sites historically omitted the Authorization header and only worked
 * because the API was unauthenticated. This wrapper guarantees the header is
 * present everywhere, so the API can enforce auth on all routes without each
 * fetch having to remember to send it. Patches window.fetch exactly once.
 */
export default function ApiAuth() {
  useEffect(() => {
    const w = window as unknown as { __btFetchPatched?: boolean };
    if (w.__btFetchPatched) return;
    w.__btFetchPatched = true;

    const orig = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      let url = '';
      try {
        url =
          typeof input === 'string' ? input :
          input instanceof URL ? input.pathname :
          (input as Request).url || '';
        // Only touch our own API calls.
        const isApi = url.startsWith('/api/') || url.includes('/api/');
        if (isApi) {
          const token = localStorage.getItem('bt_token') || '';
          if (token) {
            const headers = new Headers(
              init?.headers || (input instanceof Request ? input.headers : undefined)
            );
            if (!headers.has('Authorization')) {
              headers.set('Authorization', 'Bearer ' + token);
              init = { ...(init || {}), headers };
            }
          }
        }
      } catch { /* fall through to normal fetch */ }

      const res = await orig(input as RequestInfo, init);
      // Global session-expiry handling: if an authenticated /api call comes back
      // 401 (token expired/invalid), clear the session and send the user to login
      // once — rather than every page silently showing empty/stale data. Skip the
      // login call itself and the login page to avoid a redirect loop.
      try {
        const isApi = url.startsWith('/api/') || url.includes('/api/');
        if (res.status === 401 && isApi && !url.includes('/auth/login')
            && localStorage.getItem('bt_token')
            && !location.pathname.startsWith('/login')) {
          localStorage.removeItem('bt_token');
          document.cookie = 'bt_token=; Path=/; Max-Age=0; SameSite=Lax';
          location.href = '/login';
        }
      } catch { /* ignore */ }
      return res;
    };
  }, []);

  return null;
}
