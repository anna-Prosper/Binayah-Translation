import { NextRequest, NextResponse } from 'next/server';

function decodeJwt(token: string) {
  try {
    const b = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b.padEnd(b.length + (4 - b.length % 4) % 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));
  } catch { return null; }
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow static assets, API routes, login
  if (pathname === '/login') return NextResponse.next();
  if (pathname.startsWith('/api/')) return NextResponse.next();

  const token = request.cookies.get('bt_token')?.value;
  if (!token) return NextResponse.redirect(new URL('/login', request.url));

  const payload = decodeJwt(token);
  if (!payload) return NextResponse.redirect(new URL('/login', request.url));

  // Super admin check — handles BOTH old tokens (admin:true) AND new tokens (role:'superadmin')
  const isSuperAdmin = payload.role === 'superadmin' || payload.admin === true;

  // Super admin has full access — no restrictions at all
  if (isSuperAdmin) return NextResponse.next();

  // Regular user restrictions
  const hidden: string[] = payload.permissions?.hide_modules || [];

  // Settings — superadmin only
  if (pathname.startsWith('/settings')) {
    return NextResponse.redirect(new URL('/', request.url));
  }
  // Users — superadmin only
  if (pathname.startsWith('/users')) {
    return NextResponse.redirect(new URL('/', request.url));
  }
  // Languages — only if hidden
  if (pathname.startsWith('/languages') && hidden.includes('languages')) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|favicon.jpg|logo.svg|icon.png).*)'],
};
