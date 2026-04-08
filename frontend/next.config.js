/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.STANDALONE === "true" ? "standalone" : undefined,
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
      {
        source: "/prototypes/:path*",
        destination: `${backendUrl}/prototypes/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
