import type { ReactNode } from 'react';

/**
 * Layout for unauthenticated public listen pages (no dashboard chrome).
 * @param props - Child page content.
 * @returns Minimal layout wrapper.
 */
export default function ListenLayout(props: { children: ReactNode }) {
  return props.children;
}
