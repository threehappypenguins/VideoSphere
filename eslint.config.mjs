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
  ...nextVitals,
  // Accessibility rules — catches common a11y issues in JSX
  // eslint-config-next already registers jsx-a11y as a plugin,
  // so we only add the recommended rules here.
  {
    rules: {
      ...jsxA11y.configs.recommended.rules,
    },
  },
  // Override default ignores
  globalIgnores(['.next/**', 'out/**', 'build/**', 'coverage/**', 'next-env.d.ts']),
]);

export default eslintConfig;
