// vitest-axe@0.1.0 augments the old `namespace Vi` which does not exist in
// vitest 4.x.  This file provides the equivalent augmentation via the module
// path that vitest 4.x actually uses.
import type { AxeMatchers } from 'vitest-axe/matchers';

declare module '@vitest/expect' {
  interface Assertion<T = unknown> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
