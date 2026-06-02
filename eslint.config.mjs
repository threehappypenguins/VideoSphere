// =============================================================================
// ESLINT CONFIGURATION
// =============================================================================
// This project uses ESLint 9 with the flat config format.
// Next.js provides eslint-config-next which includes recommended rules.
// We also add eslint-plugin-jsx-a11y for accessibility linting.
//
// See /docs/code-quality.md for details on what each rule does and how
// to extend this configuration.
// =============================================================================

import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import jsxA11y from 'eslint-plugin-jsx-a11y';

const eslintConfig = defineConfig([
  ...nextVitals.map((config) =>
    config.plugins?.['jsx-a11y']
      ? {
          ...config,
          rules: {
            ...config.rules,
            ...jsxA11y.configs.recommended.rules,
          },
        }
      : config
  ),
  {
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  // Override default ignores
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'docs/.vitepress/cache/**',
    'docs/.vitepress/dist/**',
    'docs/public/typedoc/**',
    'next-env.d.ts',
  ]),
]);

export default eslintConfig;
