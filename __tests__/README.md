# Tests

Centralized test suite for VideoSphere. All test files are organized in this directory by feature/module.

## Directory Structure

```
__tests__/
├── auth/                      # Authentication-related tests
│   ├── auth-client.test.ts    # Auth utilities module tests
│   └── integration.test.ts     # Authentication flow integration tests
├── pages/                      # Page component tests
│   └── login.test.tsx          # Login page component tests
└── README.md                   # This file
```

## Test Organization

Tests are organized by **feature/module** in centralized folders:

- **`auth/`** - Authentication utilities and auth-related logic
  - `auth-client.test.ts` - Module structure validation for auth utilities
  - `integration.test.ts` - Integration tests for authentication flows

- **`pages/`** - Next.js page component tests
  - `login.test.tsx` - LoginPage component structure and behavior tests

## Running Tests

```bash
pnpm test                    # Run all tests in watch mode
pnpm test --run              # Run all tests once (CI mode)
pnpm test:ui                 # Open the Vitest UI dashboard
pnpm test:coverage           # Generate coverage report
pnpm test auth               # Run only auth-related tests
pnpm test pages/login.test   # Run only login page tests
```

## Test Strategy

### Unit Tests
- **auth-client.test.ts** - Validates the auth utilities module structure

### Component Tests
- **login.test.tsx** - Tests LoginPage component structure and attributes

### Integration Tests
- **integration.test.ts** - Tests authentication flow coordination

### Validation Methods

Since auth/data infrastructure relies on external services, validation happens through:

1. **Static Type Checking** - `pnpm type-check` validates TypeScript types
2. **Component Structure** - Test files validate JSX structure and attributes
3. **Manual Testing** - Test with local MongoDB + API routes during development
4. **E2E Testing** - Recommended for complete auth and upload flow coverage

## Testing Best Practices

- Write tests alongside features
- Focus on component behavior and structure
- Use integration tests for auth flows
- Use E2E tests with realistic local service dependencies for complete coverage
- Run `pnpm type-check` to validate TypeScript

## Learn More

See **[/docs/testing.md](/docs/testing.md)** for guidance on writing tests with Vitest and React Testing Library.
