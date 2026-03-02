import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone', // required for Docker (produces server.js)
};

export default nextConfig;
