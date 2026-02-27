# State Management Guide

## What Is State Management?

State is data that changes over time in your application — things like the current user, a shopping cart, form inputs, or UI toggles. **State management** is how you organize, share, and update that data across your components.

## Built-In React State (Start Here)

Before reaching for an external library, try React's built-in tools:

### `useState` — Local Component State

```tsx
const [count, setCount] = useState(0);
```

Use for: simple state local to one component (form inputs, toggles, counters).

### `useReducer` — Complex Local State

```tsx
const [state, dispatch] = useReducer(reducer, initialState);
```

Use for: complex state logic with multiple sub-values or when the next state depends on the previous one.

### Context API — Shared State

```tsx
const ThemeContext = createContext('light');

// Provider wraps components that need the value
<ThemeContext.Provider value="dark">
  <App />
</ThemeContext.Provider>;

// Consumer reads the value
const theme = useContext(ThemeContext);
```

Use for: global values that don't change frequently (theme, locale, current user).

**Warning**: Context API re-renders all consumers when the value changes. For frequently updating state, consider a dedicated state management library.

## When to Use an External Library

Signs you might need one:

- Multiple components across different routes need the same data
- You're "prop drilling" (passing props through many layers)
- Context API is causing performance issues
- Your state logic is getting complex to manage

## Options

### Zustand (Recommended)

[Zustand](https://github.com/pmndrs/zustand) is a small, fast, and unopinionated state management library. It's the simplest way to add global state to a React app.

**Pros**: Tiny bundle size, simple API, no boilerplate, works with Next.js  
**Cons**: Less structure than Redux (can be a pro depending on preference)

#### Getting Started with Zustand

```bash
pnpm add zustand
```

```typescript
// lib/store.ts
import { create } from 'zustand';

interface AppState {
  count: number;
  increment: () => void;
  decrement: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
  decrement: () => set((state) => ({ count: state.count - 1 })),
}));
```

```tsx
// In any component
'use client';
import { useAppStore } from '@/lib/store';

export default function Counter() {
  const { count, increment, decrement } = useAppStore();
  return (
    <div>
      <button onClick={decrement}>-</button>
      <span>{count}</span>
      <button onClick={increment}>+</button>
    </div>
  );
}
```

### Redux Toolkit

**Pros**: Battle-tested, large ecosystem, great DevTools, structured patterns  
**Cons**: More boilerplate, steeper learning curve

### Jotai

**Pros**: Atomic state model, minimal API, great for fine-grained reactivity  
**Cons**: Different mental model, smaller community

### Recoil

**Pros**: Built by Meta, atom-based, integrates well with React  
**Cons**: Still experimental, larger bundle

## Server State vs Client State

Not all state is the same. Data fetched from an API or database is **server state** — it has different concerns (caching, revalidation, loading states).

For server state, consider **[TanStack Query](https://tanstack.com/query)** (formerly React Query):

```bash
pnpm add @tanstack/react-query
```

TanStack Query handles caching, background refetching, pagination, and more — so you don't have to.

## Useful Resources

- [Zustand Documentation](https://github.com/pmndrs/zustand)
- [Redux Toolkit](https://redux-toolkit.js.org/)
- [TanStack Query](https://tanstack.com/query)
- [React State Management (Next.js Docs)](https://nextjs.org/docs/app/building-your-application/rendering/composition-patterns)
