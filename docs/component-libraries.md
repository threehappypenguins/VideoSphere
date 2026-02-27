# Component Libraries Guide

## Overview

Component libraries provide pre-built, styled, accessible UI components so you don't have to build everything from scratch. Choosing the right library is one of the first decisions your team should make.

## shadcn/ui (Recommended)

[shadcn/ui](https://ui.shadcn.com/) is the **recommended component library** for this project.

**Why shadcn/ui?**

- **Not a dependency** — components are copied into your project, so you own the code
- **Built on Radix UI** — accessible by default
- **Tailwind CSS** — uses the same styling approach as this project
- **Fully customizable** — modify any component to fit your design
- **Next.js compatible** — works perfectly with App Router and Server Components

### Step-by-Step Installation

1. **Initialize shadcn/ui in your project:**

```bash
pnpm dlx shadcn@latest init
```

2. **Answer the prompts:**
   - Style: Default
   - Base color: Choose your preference
   - CSS variables: Yes

3. **Add components as you need them:**

```bash
# Add a button component
pnpm dlx shadcn@latest add button

# Add a card component
pnpm dlx shadcn@latest add card

# Add a dialog (modal) component
pnpm dlx shadcn@latest add dialog

# Add multiple components at once
pnpm dlx shadcn@latest add button card input label
```

4. **Use the component:**

```tsx
import { Button } from '@/components/ui/button';

export default function MyPage() {
  return (
    <div>
      <Button variant="default">Primary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="destructive">Delete</Button>
    </div>
  );
}
```

### Available Components

shadcn/ui includes 40+ components. Some commonly used ones:

| Component     | Use Case                         |
| ------------- | -------------------------------- |
| Button        | Actions and submissions          |
| Card          | Grouped content display          |
| Dialog        | Modals and confirmations         |
| Input         | Text inputs for forms            |
| Label         | Form field labels                |
| Select        | Dropdown selections              |
| Table         | Data tables                      |
| Tabs          | Tab navigation within a page     |
| Toast         | Notification messages            |
| Avatar        | User profile images              |
| Badge         | Status indicators                |
| Dropdown Menu | Context menus and dropdown menus |
| Sheet         | Slide-out side panels            |
| Skeleton      | Loading placeholders             |

Browse all components at [ui.shadcn.com/docs/components](https://ui.shadcn.com/docs/components).

## DaisyUI

[DaisyUI](https://daisyui.com/) adds component classes to Tailwind CSS.

**Pros:**

- Easy setup — just a Tailwind plugin
- Many built-in themes
- Pure CSS classes, minimal JavaScript

**Cons:**

- Less control over component internals
- Accessibility may need manual additions

**Quick Start:**

```bash
pnpm add -D daisyui@latest
```

```css
/* In your Tailwind CSS config */
@plugin "daisyui";
```

```tsx
<button className="btn btn-primary">Primary Button</button>
<div className="card bg-base-100 shadow-xl">
  <div className="card-body">
    <h2 className="card-title">Card Title</h2>
    <p>Card content</p>
  </div>
</div>
```

## MUI (Material UI)

[MUI](https://mui.com/) implements Google's Material Design. It's one of the most mature React component libraries.

**Pros:**

- Extremely comprehensive component set
- Built-in theming system
- Excellent documentation

**Cons:**

- Large bundle size
- Different styling approach from Tailwind (uses CSS-in-JS)
- Can feel heavy for a Next.js project

**Best for:** Projects that want to follow Material Design closely.

```bash
pnpm add @mui/material @emotion/react @emotion/styled
```

## Chakra UI

[Chakra UI](https://chakra-ui.com/) provides accessible, composable React components with a props-based styling API.

**Pros:**

- Strong accessibility built in
- Intuitive style props API
- Good dark mode support

**Cons:**

- Style props approach differs from Tailwind
- Smaller component set than MUI
- Version 3 uses a different API than v2

```bash
pnpm add @chakra-ui/react
```

## Radix UI

[Radix UI](https://www.radix-ui.com/) provides unstyled, accessible primitives. You bring your own styles.

**Pros:**

- Maximum control over styling
- Excellent accessibility
- Small bundle size

**Cons:**

- Requires you to style everything yourself
- More work than a fully styled library

**Note:** shadcn/ui is built on top of Radix UI. If you use shadcn/ui, you're already using Radix primitives with pre-built styles.

## How to Choose

| Factor               | shadcn/ui       | DaisyUI        | MUI            | Chakra UI      |
| -------------------- | --------------- | -------------- | -------------- | -------------- |
| Tailwind integration | ✅ Native       | ✅ Plugin      | ❌ Separate    | ❌ Style props |
| Accessibility        | ✅ Radix-based  | ⚠️ Partial     | ✅ Strong      | ✅ Strong      |
| Customization        | ✅ Full control | ⚠️ Theme-based | ⚠️ Theme-based | ⚠️ Token-based |
| Learning Curve       | Low             | Very Low       | Medium         | Medium         |
| Bundle Size          | Small           | Small          | Large          | Medium         |
| For this project     | ✅ Recommended  | Good           | Okay           | Okay           |

### Decision Criteria

1. **Already using Tailwind?** → shadcn/ui or DaisyUI
2. **Want maximum accessibility out of the box?** → shadcn/ui or Chakra UI
3. **Want to style everything yourself?** → Radix UI directly
4. **Want Material Design?** → MUI
5. **Want the simplest setup?** → DaisyUI

## Useful Resources

- [shadcn/ui Documentation](https://ui.shadcn.com/)
- [DaisyUI Documentation](https://daisyui.com/)
- [MUI Documentation](https://mui.com/material-ui/)
- [Chakra UI Documentation](https://chakra-ui.com/)
- [Radix UI Documentation](https://www.radix-ui.com/)
