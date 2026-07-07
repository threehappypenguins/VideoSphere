# API Routes Guide

## How Next.js API Routes Work

Next.js App Router uses **Route Handlers** — files named `route.ts` inside the `app/api/` directory. Each file can export functions for different HTTP methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.

```
app/
  api/
    health/
      route.ts    →  GET /api/health
    drafts/
      route.ts    →  GET /api/drafts, POST /api/drafts
      [id]/
        route.ts  →  GET /api/drafts/:id, PATCH /api/drafts/:id, DELETE /api/drafts/:id
    uploads/
      presign/
        route.ts  →  POST /api/uploads/presign
```

## HTTP Method Handlers

```typescript
// app/api/drafts/route.ts
import { NextRequest, NextResponse } from 'next/server';

// GET — Retrieve data
export async function GET() {
  return NextResponse.json({ data: [] }, { status: 200 });
}

// POST — Create data
export async function POST(request: NextRequest) {
  const body = await request.json();
  return NextResponse.json({ data: body }, { status: 201 });
}
```

## TypeScript Typing

Define types for your request and response data:

```typescript
interface CreateUserRequest {
  name: string;
  email: string;
}

interface UserResponse {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export async function POST(request: NextRequest) {
  const body: CreateUserRequest = await request.json();

  const user: UserResponse = {
    id: crypto.randomUUID(),
    name: body.name,
    email: body.email,
    createdAt: new Date().toISOString(),
  };

  return NextResponse.json(user, { status: 201 });
}
```

## Error Handling

Always wrap your route handlers in try/catch and return appropriate status codes:

```typescript
export async function GET() {
  try {
    const data = await fetchData();
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error('Error fetching data:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to fetch data' },
      { status: 500 }
    );
  }
}
```

### Common HTTP Status Codes

| Code | Meaning               | When to Use                            |
| ---- | --------------------- | -------------------------------------- |
| 200  | OK                    | Successful GET, PUT, PATCH, DELETE     |
| 201  | Created               | Successful POST (new resource created) |
| 400  | Bad Request           | Invalid input / validation failure     |
| 401  | Unauthorized          | Not logged in                          |
| 403  | Forbidden             | Logged in but insufficient permissions |
| 404  | Not Found             | Resource doesn't exist                 |
| 500  | Internal Server Error | Something went wrong on the server     |

## Adding a New Route

1. Create a new directory under `app/api/`: `app/api/your-route/`
2. Create `route.ts` inside it
3. Export the HTTP method handlers you need
4. Add TypeScript types for your request/response data
5. Add error handling with try/catch

## Server Actions (Alternative)

Next.js also supports **Server Actions** — functions that run on the server and can be called directly from Client Components without creating an API endpoint:

```typescript
// app/actions.ts
'use server';

export async function createUser(formData: FormData) {
  const name = formData.get('name') as string;
  // Insert into database...
  return { success: true };
}
```

```tsx
// In a Client Component
<form action={createUser}>
  <input name="name" />
  <button type="submit">Create</button>
</form>
```

Server Actions are great for form submissions and mutations. Use API routes when you need a traditional REST API.

## Routes in This Project

VideoSphere uses route handlers under `app/api/`. Common entry points:

| Method | Route | Purpose |
| ------ | ----- | ------- |
| `GET` | `/api/health` | Health check |
| `POST` | `/api/drafts` | Create a draft |
| `GET` | `/api/drafts` | List drafts |
| `PATCH` | `/api/drafts/[id]` | Update draft metadata |
| `POST` | `/api/uploads/presign` | Get presigned R2 upload URL |
| `POST` | `/api/uploads/[jobId]/complete` | Confirm R2 upload |
| `POST` | `/api/uploads/distribute` | Start platform distribution |
| `POST` | `/api/ai/generate-metadata` | Generate title, description, tags |

See `app/api/README.md` in the repository for route domains. Run `pnpm docs:api` for full TypeDoc output.

## Useful Resources

- [Next.js Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)
- [Next.js Server Actions](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations)
