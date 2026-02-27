# Accessibility Guide

## Why Accessibility Matters

Accessibility (often abbreviated as **a11y**) means making your website usable by everyone, including people with disabilities. This includes people who:

- Use screen readers (visual impairments)
- Navigate with keyboards only (motor impairments)
- Have color vision deficiency
- Use assistive technologies

Beyond being the right thing to do, accessibility is often a **legal requirement** and is always good engineering practice.

## WCAG 2.1 Overview

The [Web Content Accessibility Guidelines (WCAG) 2.1](https://www.w3.org/WAI/WCAG21/quickref/) define three levels of conformance:

| Level | Description                    | Target for This Project |
| ----- | ------------------------------ | ----------------------- |
| A     | Minimum accessibility          | ✅ Required             |
| AA    | Addresses major barriers       | ✅ Recommended          |
| AAA   | Highest level of accessibility | Optional                |

Your project should aim for **WCAG 2.1 Level AA** compliance.

## Semantic HTML

Use HTML elements for their intended purpose rather than styling `<div>` elements to look like buttons.

### Do This

```tsx
<button onClick={handleSubmit}>Submit</button>
<nav aria-label="Main navigation">...</nav>
<main>...</main>
<h1>Page Title</h1>
<h2>Section Title</h2>
```

### Avoid This

```tsx
{/* ❌ Don't use div as a button */}
<div onClick={handleSubmit}>Submit</div>

{/* ❌ Don't skip heading levels */}
<h1>Title</h1>
<h3>Subtitle</h3>  {/* Skipped h2! */}
```

### Key Semantic Elements

| Element     | Purpose                                 |
| ----------- | --------------------------------------- |
| `<header>`  | Page or section header                  |
| `<nav>`     | Navigation links                        |
| `<main>`    | Primary page content (one per page)     |
| `<footer>`  | Page or section footer                  |
| `<section>` | Thematic grouping of content            |
| `<article>` | Self-contained content                  |
| `<aside>`   | Tangential/supplementary content        |
| `<button>`  | Interactive element that does something |
| `<a>`       | Navigation to another page/section      |

## ARIA Attributes

ARIA (Accessible Rich Internet Applications) attributes provide additional information to screen readers when semantic HTML alone isn't sufficient.

### Common ARIA Attributes

```tsx
// Labels for icon-only buttons
<button aria-label="Close menu">
  <XIcon />
</button>

// Describing current state
<nav aria-expanded={isOpen}>...</nav>

// Indicating the current page
<a href="/dashboard" aria-current="page">Dashboard</a>

// Live regions for dynamic content
<div aria-live="polite" role="status">
  {message}
</div>
```

### Rules for ARIA

1. **Don't use ARIA if a native HTML element works** — `<button>` is better than `<div role="button">`
2. **Don't change native semantics** — don't add `role="button"` to an `<a>` tag
3. **All interactive ARIA elements must be keyboard accessible**
4. **Don't use `aria-hidden="true"` on focusable elements**

## Forms and Labels

Every form input must have an associated label:

```tsx
{/* Method 1: htmlFor attribute */}
<label htmlFor="email">Email</label>
<input id="email" type="email" />

{/* Method 2: Wrapping */}
<label>
  Email
  <input type="email" />
</label>

{/* Method 3: aria-label for visually hidden labels */}
<input type="search" aria-label="Search products" placeholder="Search..." />
```

### Error Messages

Connect error messages to their inputs:

```tsx
<label htmlFor="password">Password</label>
<input
  id="password"
  type="password"
  aria-describedby="password-error"
  aria-invalid={!!error}
/>
{error && (
  <p id="password-error" role="alert">
    {error}
  </p>
)}
```

## Images

All images must have alt text:

```tsx
{
  /* Informative image */
}
<img src="/team-photo.jpg" alt="Team members at the 2024 hackathon" />;

{
  /* Decorative image — empty alt */
}
<img src="/divider.svg" alt="" />;

{
  /* Next.js Image component */
}
import Image from 'next/image';
<Image src="/logo.svg" alt="Company logo" width={120} height={40} />;
```

## Color Contrast

Text must have sufficient contrast against its background:

- **Normal text**: minimum contrast ratio of **4.5:1** (WCAG AA)
- **Large text** (18px+ bold or 24px+): minimum **3:1**

### Checking Contrast

Use these tools:

- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
- Chrome DevTools → Inspect element → hover over color values
- Lighthouse accessibility audit

### Don't Rely on Color Alone

When conveying information (errors, status, etc.), use **more than just color**:

```tsx
{
  /* ✅ Color + icon + text */
}
<span className="text-red-500">❌ Error: Invalid email</span>;

{
  /* ❌ Color only — invisible to color-blind users */
}
<span className="text-red-500">Invalid email</span>;
```

## Keyboard Navigation

All interactive elements must be reachable and usable with a keyboard:

- **Tab** moves to the next focusable element
- **Shift+Tab** moves to the previous
- **Enter/Space** activates buttons
- **Escape** closes modals/menus
- **Arrow keys** navigate within widgets

### Focus Management

```tsx
// Visible focus styles (already in Tailwind — don't remove them!)
<button className="focus:outline-none focus:ring-2 focus:ring-blue-500">
  Click me
</button>

// Skip navigation link (add to layout)
<a href="#main-content" className="sr-only focus:not-sr-only">
  Skip to main content
</a>
```

## What eslint-plugin-jsx-a11y Catches

This project includes `eslint-plugin-jsx-a11y` which automatically catches many common issues:

- Missing `alt` prop on `<img>`
- Click handlers on non-interactive elements without keyboard support
- Missing `aria-label` on icon-only buttons
- Invalid ARIA attributes
- Elements with `role` but missing required ARIA props

Run `pnpm lint` to check for these issues.

## Testing Accessibility

### Manual Testing Checklist

- [ ] Navigate entire page using only keyboard
- [ ] Check all images have appropriate alt text
- [ ] Verify color contrast meets WCAG AA
- [ ] Test with screen reader (VoiceOver on Mac, NVDA on Windows)
- [ ] Ensure focus is visible on all interactive elements
- [ ] Check heading hierarchy (h1 → h2 → h3, no skips)

### Automated Testing

```bash
# Lighthouse audit (in Chrome DevTools → Lighthouse tab)
# Select "Accessibility" category and run

# Or install axe DevTools browser extension
# https://www.deque.com/axe/devtools/
```

## Useful Resources

- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [The A11Y Project Checklist](https://www.a11yproject.com/checklist/)
- [MDN Accessibility Guide](https://developer.mozilla.org/en-US/docs/Web/Accessibility)
- [WebAIM](https://webaim.org/)
- [axe DevTools](https://www.deque.com/axe/devtools/)
