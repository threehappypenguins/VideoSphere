# Performance Guide

## Server Components vs Client Components

Next.js uses **React Server Components** by default. Understanding when to use each type is the most impactful performance decision you'll make.

### Server Components (Default)

Components render on the server. The browser receives HTML, not JavaScript.

```tsx
// This is a Server Component by default — no directive needed
export default function ProductList() {
  return (
    <div>
      <h1>Products</h1>
      {/* This component ships zero JavaScript to the browser */}
    </div>
  );
}
```

**Use for**: Static content, data fetching, layouts, pages, anything that doesn't need interactivity.

### Client Components

Components render on the client. Add `'use client'` at the top of the file.

```tsx
'use client';

import { useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>Count: {count}</button>;
}
```

**Use for**: Event handlers (`onClick`, `onChange`), `useState`, `useEffect`, browser APIs.

### The Rule

> Keep Client Components as **small and specific** as possible. Push `'use client'` down to the **leaf** components that actually need interactivity.

```
// ✅ Good: Only the interactive part is a Client Component
<ProductPage>              {/* Server Component */}
  <ProductDetails />       {/* Server Component */}
  <AddToCartButton />      {/* Client Component */}
</ProductPage>

// ❌ Bad: Entire page is a Client Component because of one button
'use client'
<ProductPage>              {/* Everything ships as JavaScript */}
  <ProductDetails />
  <AddToCartButton />
</ProductPage>
```

## Image Optimization

Use Next.js `<Image>` component instead of the HTML `<img>` tag. It automatically:

- Serves images in modern formats (WebP, AVIF)
- Lazy loads images below the fold
- Prevents layout shift with required width/height
- Generates responsive sizes

```tsx
import Image from 'next/image';

// Local image
import heroImage from '@/public/hero.jpg';

export default function Hero() {
  return (
    <Image
      src={heroImage}
      alt="Hero banner showing the product in action"
      priority // Add for above-the-fold images (disables lazy loading)
      placeholder="blur" // Shows blurred version while loading
    />
  );
}

// Remote image (must configure domains in next.config.ts)
<Image src="https://example.com/photo.jpg" alt="Description" width={800} height={600} />;
```

### Configuring Remote Images

```typescript
// next.config.ts
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'example.com',
      },
    ],
  },
};
```

## Font Optimization

This project uses `next/font` to load the Inter font. It automatically:

- Self-hosts the font (no external requests to Google)
- Eliminates layout shift with `font-display: swap`
- Generates optimal font subsets

See the current setup in `app/layout.tsx`:

```tsx
import { Inter } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});
```

### Adding More Fonts

```tsx
import { Inter, Roboto_Mono } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const robotoMono = Roboto_Mono({ subsets: ['latin'], variable: '--font-mono' });

// Apply both in the body className
<body className={`${inter.variable} ${robotoMono.variable}`}>
```

## Metadata for SEO

Next.js provides a built-in `Metadata` API. The project already has base metadata in `app/layout.tsx`. Add page-specific metadata:

```tsx
// app/about/page.tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About Us',
  description: 'Learn about our team and mission.',
  openGraph: {
    title: 'About Us',
    description: 'Learn about our team and mission.',
  },
};
```

## Dynamic Imports (Code Splitting)

Use `next/dynamic` to load components only when needed:

```tsx
import dynamic from 'next/dynamic';

// This component won't be included in the initial JavaScript bundle
const HeavyChart = dynamic(() => import('@/components/HeavyChart'), {
  loading: () => <p>Loading chart...</p>,
});

export default function Dashboard() {
  return (
    <div>
      <h1>Dashboard</h1>
      <HeavyChart />
    </div>
  );
}
```

### When to Use Dynamic Imports

- Large charting/visualization libraries
- Rich text editors
- Components behind modals or tabs (not visible initially)
- Components that use browser-only APIs

## React Suspense & Loading UI

Next.js uses `loading.tsx` files to show instant loading states:

```
app/
├── dashboard/
│   ├── page.tsx      // The page content
│   └── loading.tsx   // Shows while page is loading
```

```tsx
// app/dashboard/loading.tsx
export default function Loading() {
  return <div className="animate-pulse">Loading dashboard...</div>;
}
```

For more granular loading states within a page:

```tsx
import { Suspense } from 'react';

export default function Page() {
  return (
    <div>
      <h1>Dashboard</h1>
      <Suspense fallback={<div>Loading stats...</div>}>
        <StatsSection />
      </Suspense>
      <Suspense fallback={<div>Loading chart...</div>}>
        <ChartSection />
      </Suspense>
    </div>
  );
}
```

## Running Lighthouse

Lighthouse is a built-in Chrome tool that audits your site for performance, accessibility, SEO, and best practices.

### How to Run

1. Open your site in Chrome
2. Open DevTools (F12 or Cmd+Opt+I)
3. Go to the **Lighthouse** tab
4. Select categories: Performance, Accessibility, Best Practices, SEO
5. Select **Navigation** mode
6. Click **Analyze page load**

### Key Metrics

| Metric                         | Target  | What It Measures                         |
| ------------------------------ | ------- | ---------------------------------------- |
| First Contentful Paint (FCP)   | < 1.8s  | Time until first content appears         |
| Largest Contentful Paint (LCP) | < 2.5s  | Time until largest content element loads |
| Cumulative Layout Shift (CLS)  | < 0.1   | Visual stability (things jumping around) |
| Total Blocking Time (TBT)      | < 200ms | Time the main thread is blocked          |

## Quick Wins Checklist

- [ ] Use Server Components wherever possible (no `'use client'` unless needed)
- [ ] Use `next/image` for all images
- [ ] Add `priority` prop to above-the-fold images
- [ ] Use `next/font` for all custom fonts
- [ ] Add meaningful `metadata` to all pages
- [ ] Use `next/dynamic` for heavy components
- [ ] Run Lighthouse and aim for 90+ scores

## Useful Resources

- [Next.js Performance](https://nextjs.org/docs/app/building-your-application/optimizing)
- [Web Vitals](https://web.dev/vitals/)
- [Lighthouse](https://developer.chrome.com/docs/lighthouse/)
- [React Server Components](https://react.dev/reference/rsc/server-components)
