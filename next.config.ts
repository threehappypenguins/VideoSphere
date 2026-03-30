import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone', // required for Docker (produces server.js)
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.r2.cloudflarestorage.com',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
