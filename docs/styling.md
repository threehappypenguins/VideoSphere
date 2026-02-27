# Styling Guide

## Tailwind CSS

This project uses **Tailwind CSS** — a utility-first CSS framework. Instead of writing traditional CSS classes, you apply small, single-purpose utility classes directly in your HTML/JSX.

### How Utility-First CSS Works

```jsx
// Traditional CSS approach
<div className="card">
  <h2 className="card-title">Hello</h2>
</div>

// Tailwind utility-first approach
<div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
  <h2 className="text-xl font-semibold text-gray-900">Hello</h2>
</div>
```

The Tailwind approach keeps your styles co-located with your markup, making it easier to see exactly what each element looks like without jumping between files.

### Key Tailwind Concepts

- **Responsive design**: Use breakpoint prefixes like `md:`, `lg:`, `xl:` for responsive styles
  - `text-sm md:text-base lg:text-lg` — font size increases at each breakpoint
  - Mobile-first: styles without a prefix apply to all screen sizes
- **Hover/focus states**: Use `hover:`, `focus:`, `active:` prefixes
  - `bg-blue-500 hover:bg-blue-600` — darker on hover
- **Dark mode**: Use the `dark:` prefix (see Dark Mode section below)

## Customizing Your Theme

### Tailwind CSS v4 (CSS-Based Configuration)

This project uses **Tailwind CSS v4**, which uses CSS-based configuration instead of a JavaScript config file. Your design tokens are defined in `app/globals.css` using CSS custom properties and the `@theme` directive.

```css
/* In app/globals.css */
:root {
  --primary: #2563eb; /* Your brand color */
  --background: #ffffff; /* Page background */
  --foreground: #171717; /* Text color */
}

@theme inline {
  --color-primary: var(--primary);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
}
```

After defining a color in `@theme`, you can use it as a Tailwind utility:

- `bg-primary`, `text-primary`, `border-primary`
- `bg-background`, `text-foreground`

### Adding Custom Colors

1. Add a CSS variable in `:root` in `globals.css`
2. Map it in the `@theme` block
3. Use it in your JSX with Tailwind utilities

```css
:root {
  --accent: #f59e0b;
}

@theme inline {
  --color-accent: var(--accent);
}
```

Now you can use `bg-accent`, `text-accent`, etc.

## Font Configuration

This project uses **Inter** via `next/font/google`. Next.js automatically optimizes fonts — they're downloaded at build time and served as local files, eliminating extra network requests.

### How to Change the Font

1. Open `app/layout.tsx`
2. Replace `Inter` with your chosen font:

```typescript
// Before
import { Inter } from 'next/font/google';
const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });

// After — example with Poppins
import { Poppins } from 'next/font/google';
const poppins = Poppins({
  variable: '--font-poppins',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});
```

3. Update `globals.css` to reference the new CSS variable:

```css
@theme inline {
  --font-sans: var(--font-poppins);
}
```

### Adding Multiple Fonts

You can import multiple fonts and use them for different purposes:

```typescript
import { Inter, JetBrains_Mono } from 'next/font/google';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });
const jetbrains = JetBrains_Mono({ variable: '--font-mono', subsets: ['latin'] });
```

Browse available fonts at [fonts.google.com](https://fonts.google.com/).

## Component Libraries

No component library is pre-installed — you can choose the one that fits your project best. See [/docs/component-libraries.md](/docs/component-libraries.md) for a detailed comparison with installation guides.

**Our recommendation**: [shadcn/ui](https://ui.shadcn.com/) — beautiful, accessible components that you own (copied into your project, not installed as a dependency).

## Dark Mode

Dark mode is listed as a **stretch goal** in `STRETCH_GOALS.md`. Here's an overview of how to implement it:

1. **Define dark mode colors** in `globals.css`:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --background: #0a0a0a;
    --foreground: #ededed;
    --primary: #3b82f6;
  }
}
```

2. **Use the `dark:` prefix** in your Tailwind classes for manual overrides:

```jsx
<div className="bg-white dark:bg-gray-900">
  <p className="text-gray-900 dark:text-gray-100">Hello</p>
</div>
```

3. **For a toggle button** (not just system preference), you'll need to manage a theme state. Consider libraries like `next-themes` for this.

## Useful Resources

- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Tailwind CSS v4 Guide](https://tailwindcss.com/blog/tailwindcss-v4)
- [next/font Documentation](https://nextjs.org/docs/app/building-your-application/optimizing/fonts)
- [Google Fonts](https://fonts.google.com/)
