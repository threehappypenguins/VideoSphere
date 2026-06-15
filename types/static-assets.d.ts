/**
 * Static asset modules imported at build time (Webpack / Vitest).
 * Next.js also declares these via generated `next-env.d.ts` (`next/image-types/global`),
 * but that file is gitignored; this keeps `tsc --noEmit` working in CI without a local build.
 */
declare module '*.svg' {
  import type { FC, SVGProps } from 'react';

  /** SVG imported as an inline React component via SVGR. */
  const ReactComponent: FC<SVGProps<SVGSVGElement>>;
  export default ReactComponent;
}

declare module '*.svg?url' {
  /** SVG imported as a static asset URL (append `?url` to the import path). */
  const content: string;
  export default content;
}
