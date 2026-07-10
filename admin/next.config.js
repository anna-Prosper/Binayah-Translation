/** @type {import('next').NextConfig} */
// Render's `property: host` yields a bare hostname (no scheme); a schemeless
// rewrite destination is treated as a relative path and breaks the proxy. Ensure
// an absolute URL. (Harmless when the env var already includes a scheme.)
let API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
if (!/^https?:\/\//.test(API_URL)) API_URL = "https://" + API_URL;

const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_URL}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
