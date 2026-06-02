import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone', // required for Docker (produces server.js)
  // Mongoose/MongoDB use Node built-ins (net, tls, etc.); must not be webpack-bundled
  // for instrumentation or other server entry points.
  serverExternalPackages: ['mongoose', 'mongodb'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        // R2 presigned URLs can be virtual-hosted style (e.g. bucket.account.r2...).
        hostname: '**.r2.cloudflarestorage.com',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
