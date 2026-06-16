import type { NextConfig } from 'next';

/** Matches `?url` (and `&url`) SVG import queries; shared by webpack and Turbopack. */
const svgUrlImportQuery = /[?&]url(?=&|$)/;

/** Turbopack: `?url` → asset URL; bare `.svg` → SVGR React component (matches webpack above). */
const platformSvgTurbopackRules: NonNullable<NextConfig['turbopack']>['rules'][string] = [
  {
    condition: { query: svgUrlImportQuery },
    type: 'asset',
  },
  {
    condition: { not: { query: svgUrlImportQuery } },
    loaders: [
      {
        loader: '@svgr/webpack',
        options: {
          icon: true,
          dimensions: false,
        },
      },
    ],
    as: '*.js',
  },
];

const nextConfig: NextConfig = {
  output: 'standalone', // required for Docker (produces server.js)
  // Mongoose/MongoDB use Node built-ins (net, tls, etc.); must not be webpack-bundled
  // for instrumentation or other server entry points.
  serverExternalPackages: ['mongoose', 'mongodb', 'ssh2'],
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
  webpack(config) {
    const fileLoaderRule = config.module.rules.find(
      (rule) =>
        typeof rule === 'object' &&
        rule !== null &&
        'test' in rule &&
        rule.test instanceof RegExp &&
        rule.test.test('.svg')
    );

    if (!fileLoaderRule || typeof fileLoaderRule !== 'object') {
      return config;
    }

    config.module.rules.push(
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: svgUrlImportQuery,
      },
      {
        test: /\.svg$/i,
        issuer: fileLoaderRule.issuer,
        resourceQuery: {
          not: [...(fileLoaderRule.resourceQuery?.not ?? []), svgUrlImportQuery],
        },
        use: [
          {
            loader: '@svgr/webpack',
            options: {
              icon: true,
              dimensions: false,
            },
          },
        ],
      }
    );

    fileLoaderRule.exclude = /\.svg$/i;

    return config;
  },
  turbopack: {
    rules: {
      '*.svg': platformSvgTurbopackRules,
    },
  },
};

export default nextConfig;
