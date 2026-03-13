'use client';

import { useEffect } from 'react';

interface FlashMessageProps {
  type: 'success' | 'error';
  message: string;
}

/**
 * Renders a one-time flash message and immediately strips the triggering
 * query param from the URL using history.replaceState — no navigation,
 * no re-render, no visible URL flicker. A refresh won't re-show the message.
 */
export function FlashMessage({ type, message }: FlashMessageProps) {
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('success');
    url.searchParams.delete('error');
    window.history.replaceState(null, '', url.pathname + (url.search || ''));
  }, []);

  if (type === 'success') {
    return (
      <div
        role="status"
        className="mt-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200"
      >
        {message}
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
    >
      {message}
    </div>
  );
}
