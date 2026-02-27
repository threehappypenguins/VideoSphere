# TypeScript Guide

## What Is TypeScript?

TypeScript is a superset of JavaScript that adds **static type checking**. It helps you catch bugs before your code runs by ensuring variables, function parameters, and return values have the correct types.

Every `.ts` and `.tsx` file in this project is TypeScript. The TypeScript compiler checks your code for type errors, but the actual code that runs in the browser is still JavaScript — TypeScript is compiled away at build time.

## Why TypeScript?

- **Catch bugs early** — the compiler tells you about type mismatches before you ship
- **Better editor support** — autocomplete, hover documentation, and refactoring tools
- **Self-documenting code** — types serve as inline documentation for function signatures
- **Industry standard** — most modern web projects use TypeScript

## Relaxed Mode vs Strict Mode

This project starts in **relaxed mode** (`"strict": false` in `tsconfig.json`). This means TypeScript will be more lenient and won't enforce the strictest type-checking rules. This is intentional — it reduces friction while you're learning.

### What's Disabled in Relaxed Mode

When `strict` is `false`, these stricter checks are turned off:

| Option                         | What It Does                                  |
| ------------------------------ | --------------------------------------------- |
| `strictNullChecks`             | Allows `null` and `undefined` everywhere      |
| `strictFunctionTypes`          | Relaxes function parameter type checking      |
| `strictBindCallApply`          | Relaxes `bind`, `call`, `apply` type checking |
| `strictPropertyInitialization` | Allows uninitialized class properties         |
| `noImplicitAny`                | Allows implicit `any` types                   |
| `noImplicitThis`               | Allows implicit `any` for `this`              |
| `alwaysStrict`                 | Doesn't enforce `"use strict"` in every file  |

## Enabling Strict Mode

When your team is comfortable with TypeScript, you can enable strict mode for better type safety.

### Step-by-Step

1. Open `tsconfig.json` in the project root
2. Change `"strict": false` to `"strict": true`
3. Run `pnpm type-check` to see what errors appear
4. Fix the errors one at a time (see common errors below)

```json
{
  "compilerOptions": {
    "strict": true // ← change this from false to true
  }
}
```

### Common Errors You'll See

#### 1. "Parameter implicitly has an 'any' type"

```typescript
// ❌ Error in strict mode
function greet(name) {
  return `Hello, ${name}`;
}

// ✅ Fixed — add a type annotation
function greet(name: string) {
  return `Hello, ${name}`;
}
```

#### 2. "Object is possibly 'null' or 'undefined'"

```typescript
// ❌ Error in strict mode
const element = document.getElementById('app');
element.textContent = 'Hello'; // element could be null!

// ✅ Fixed — add a null check
const element = document.getElementById('app');
if (element) {
  element.textContent = 'Hello';
}
```

#### 3. "Type 'X' is not assignable to type 'Y'"

```typescript
// ❌ Error in strict mode
let count: number = '5'; // string is not a number

// ✅ Fixed — use the correct type
let count: number = 5;
```

## Useful Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/)
- [Next.js TypeScript Guide](https://nextjs.org/docs/app/building-your-application/configuring/typescript)
- [TypeScript Playground](https://www.typescriptlang.org/play) — experiment with types online
- [Total TypeScript Beginners Tutorial](https://www.totaltypescript.com/tutorials/beginners-typescript)
