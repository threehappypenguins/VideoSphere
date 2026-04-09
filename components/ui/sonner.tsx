'use client';

import { CircleCheck, Info, LoaderCircle, OctagonX, TriangleAlert } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useCallback, useEffect, useRef } from 'react';
import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Accessible toast container that wraps Sonner.
 *
 * Sonner renders toasts as `<li>` elements inside an `<ol>` within an
 * `aria-live="polite"` `<section>`.  Screen readers announce list-item
 * positions (e.g. "1 of 1") and empty-list state ("list of 0") on every
 * toast add/remove, producing duplicate or triple read-outs.
 *
 * Fix: disable Sonner's built-in live region (`aria-live` → `"off"`) and
 * provide a separate, flat `<div aria-live="polite">` that contains only
 * plain text — no list markup.  A `MutationObserver` watches for new toast
 * text nodes inside Sonner and mirrors them into the custom live region,
 * so the screen reader announces each message exactly once.
 *
 * @param props - Forwarded to the underlying Sonner `<Toaster>`.
 * @returns The accessible Toaster element.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mirror a message into our plain-text live region.
  const announce = useCallback((message: string) => {
    const live = liveRef.current;
    if (!live) return;

    // Clear any pending removal so rapid-fire toasts don't collide.
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }

    // Reset → insert in separate frames so the screen reader treats it as
    // a new addition even if the text is identical to the previous one.
    live.textContent = '';
    requestAnimationFrame(() => {
      if (liveRef.current) {
        liveRef.current.textContent = message;
      }

      // Remove stale text after a generous window so virtual-cursor users
      // don't re-read it when navigating the page.
      clearTimerRef.current = setTimeout(() => {
        if (liveRef.current) {
          liveRef.current.textContent = '';
        }
        clearTimerRef.current = null;
      }, 5000);
    });
  }, []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    // Track the last announced text so we don't re-announce on every
    // attribute change that Sonner makes during animations.
    let lastAnnouncedText = '';

    const patchSonner = () => {
      // 1. Disable Sonner's own live region so it doesn't also announce.
      const section = wrapper.querySelector<HTMLElement>('section[aria-live]');
      if (section && section.getAttribute('aria-live') !== 'off') {
        section.setAttribute('aria-live', 'off');
      }

      // 2. Strip list semantics from <ol>/<li> so screen readers never
      //    announce positional info or "list of 0".
      wrapper.querySelectorAll('ol[data-sonner-toaster]').forEach((ol) => {
        if (ol.getAttribute('role') !== 'presentation') {
          ol.setAttribute('role', 'presentation');
        }
      });
      wrapper.querySelectorAll('li[data-sonner-toast]').forEach((li) => {
        if (li.getAttribute('role') !== 'presentation') {
          li.setAttribute('role', 'presentation');
        }
      });

      // 3. Extract the visible toast message and announce it — but only
      //    if the text actually changed since the last announcement.
      const visibleToast = wrapper.querySelector<HTMLElement>(
        'li[data-sonner-toast][data-visible="true"]'
      );
      if (visibleToast) {
        const titleEl = visibleToast.querySelector<HTMLElement>('[data-title]');
        const text = (titleEl?.textContent ?? visibleToast.textContent ?? '').trim();
        if (text && text !== lastAnnouncedText) {
          lastAnnouncedText = text;
          announce(text);
        }
      } else {
        // No visible toasts — clear the live region immediately so the
        // screen reader doesn't re-read stale content.
        lastAnnouncedText = '';
        if (liveRef.current) {
          liveRef.current.textContent = '';
        }
        if (clearTimerRef.current) {
          clearTimeout(clearTimerRef.current);
          clearTimerRef.current = null;
        }
      }
    };

    patchSonner();

    const observer = new MutationObserver(patchSonner);
    observer.observe(wrapper, { childList: true, subtree: true, attributes: true });

    return () => {
      observer.disconnect();
      if (clearTimerRef.current) {
        clearTimeout(clearTimerRef.current);
      }
    };
  }, [announce]);

  return (
    <div ref={wrapperRef}>
      {/* Custom plain-text live region — no list markup, announced once. */}
      <div ref={liveRef} role="status" aria-live="polite" aria-atomic="true" className="sr-only" />
      <Sonner
        theme={theme as ToasterProps['theme']}
        className="toaster group"
        icons={{
          success: <CircleCheck className="h-4 w-4" />,
          info: <Info className="h-4 w-4" />,
          warning: <TriangleAlert className="h-4 w-4" />,
          error: <OctagonX className="h-4 w-4" />,
          loading: <LoaderCircle className="h-4 w-4 animate-spin" />,
        }}
        toastOptions={{
          classNames: {
            toast:
              'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
            description: 'group-[.toast]:text-muted-foreground',
            actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
            cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
          },
        }}
        {...props}
      />
    </div>
  );
};

export { Toaster };
