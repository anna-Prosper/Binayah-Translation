import type { Metadata } from "next";
import { cookies } from "next/headers";
import ClientLayout from "./ClientLayout";

export const metadata: Metadata = { title: "Binayah Translate", icons: { icon: "/favicon.jpg", apple: "/favicon.jpg" } };

function decodeToken(token: string): { role: string; hidden: string[] } {
  try {
    const b = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const p = JSON.parse(Buffer.from(b.padEnd(b.length + (4 - b.length % 4) % 4, '='), 'base64').toString('utf-8'));
    const role = (p.role === 'superadmin' || p.admin === true) ? 'superadmin' : 'user';
    const hidden: string[] = p.permissions?.hide_modules || [];
    return { role, hidden };
  } catch { return { role: 'unknown', hidden: [] }; }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get('bt_token')?.value || '';
  const { role, hidden } = decodeToken(token);

  return (
    <html lang="en" data-role={role} data-hidden={hidden.join(',')}>
      <head>
        <link rel="icon" type="image/jpeg" href="/favicon.jpg" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/css/flag-icons.min.css" />
      </head>
      <body style={{ margin: 0 }}>
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
