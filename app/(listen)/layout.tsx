import type { ReactNode } from 'react';

/**
 * Layout for unauthenticated public listen pages.
 * Viewport shell only; navbar + nav-control seeding live in the slug page shell
 * so the language cookie can drive first-paint nav icons.
 * @param props - Child page content.
 * @returns Listen viewport wrapper.
 */
export default function ListenLayout(props: { children: ReactNode }) {
  return <div className="flex h-dvh flex-col overflow-hidden">{props.children}</div>;
}
