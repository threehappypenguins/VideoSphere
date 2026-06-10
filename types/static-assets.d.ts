/**
 * Static asset modules imported at build time (Webpack / Vitest).
 * Next.js also declares these via generated `next-env.d.ts` (`next/image-types/global`),
 * but that file is gitignored; this keeps `tsc --noEmit` working in CI without a local build.
 */
declare module '*.svg' {
  const content: string | { src: string; width?: number; height?: number };
  export default content;
}
