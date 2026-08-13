'use client';

import type { ReactNode } from 'react';
import Navbar from '@/components/layout/Navbar';
import {
  ListenNavControlsProvider,
  type ListenNavControlsSeed,
} from '@/components/translation/ListenNavControlsProvider';

/**
 * Public listen chrome: seeded nav controls provider + public navbar + page body.
 * @param props - SSR seed for nav icons and page children.
 * @returns Listen shell layout.
 */
export function ListenPageShell(props: {
  /** Cookie/meta seed so nav language + speaker icons exist on first paint. */
  navSeed: ListenNavControlsSeed | null;
  children: ReactNode;
}) {
  return (
    <ListenNavControlsProvider seed={props.navSeed}>
      <Navbar variant="public" />
      <div className="flex min-h-0 flex-1 flex-col">{props.children}</div>
    </ListenNavControlsProvider>
  );
}
