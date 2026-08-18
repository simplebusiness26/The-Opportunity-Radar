import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `pg` opens raw sockets; it must never be bundled into the server chunk.
  serverExternalPackages: ['pg', 'pg-native'],
  poweredByHeader: false,
  typedRoutes: false,
  experimental: {
    // Intelligence must never be read from a client router cache: a score the
    // user is looking at has to be the score the database holds.
    staleTimes: { dynamic: 0 },
  },
};

export default nextConfig;
