# Admin Dashboard Guide

## What Is the Admin Dashboard?

The admin dashboard at `/admin/dashboard` provides a management interface for users with admin privileges. It's where admins can view analytics, manage users, moderate content, and configure the application.

**In this template, the admin dashboard exists but is completely unprotected.** Securing it is your responsibility.

## Role-Based Access Control (RBAC)

RBAC is a system where users are assigned roles, and each role has specific permissions.

### Common Role Structure

| Role      | Permissions                                         |
| --------- | --------------------------------------------------- |
| **User**  | Access own profile, use core features               |
| **Admin** | Everything users can + manage users, view analytics |

You may add more roles as needed (moderator, editor, etc.).

### How Roles Are Stored

Roles are typically stored as a field on the user record:

```typescript
interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  // or for more granular control:
  permissions: string[];
}
```

### How Roles Are Checked

Check the user's role before granting access to protected resources:

```typescript
function isAdmin(user: User): boolean {
  return user.role === 'admin';
}
```

## Why Client-Side Protection Is Not Enough

The current admin dashboard page renders for anyone who visits `/admin/dashboard`. This is a **critical security issue** that you must fix.

Client-side checks (like `if (!isAdmin) return <Redirect />`) are **insufficient** because:

1. The page content is still sent to the browser — a user can inspect the HTML
2. JavaScript can be disabled or modified
3. API routes behind the dashboard are still accessible

**You need server-side protection.**

## Where to Implement Protection

### 1. middleware.ts (Redirect Before Page Loads)

The `middleware.ts` file in the project root runs **before any page renders**. Use it to check authentication and role, then redirect unauthorized users.

```typescript
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // STUDENT: Check the user's session/token here
  const userRole = ''; // Get from session/cookie

  if (request.nextUrl.pathname.startsWith('/admin')) {
    if (userRole !== 'admin') {
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
```

### 2. Server Components (Check Role Server-Side)

In the admin page itself, verify the user's role before rendering content:

```tsx
// app/(admin)/admin/dashboard/page.tsx
import { redirect } from 'next/navigation';

export default async function AdminDashboard() {
  const user = await getAuthenticatedUser();

  if (!user || user.role !== 'admin') {
    redirect('/');
  }

  // Only admins reach this point
  return <div>{/* Admin dashboard content */}</div>;
}
```

### 3. API Routes (Verify Before Returning Data)

Every API route that serves admin data must independently verify the user's role:

```typescript
// app/api/admin/users/route.ts
export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const users = await getAllUsers();
  return Response.json(users);
}
```

### Defense in Depth

Use **all three layers** together. If one fails, the others catch unauthorized access.

## BaaS Provider Role Implementations

### Supabase

Supabase uses **Row Level Security (RLS)** and user metadata for roles.

```sql
-- Add role to user metadata
UPDATE auth.users
SET raw_user_meta_data = jsonb_set(raw_user_meta_data, '{role}', '"admin"')
WHERE id = 'user-uuid';

-- RLS policy: only admins can read the admin_data table
CREATE POLICY "Admins only" ON admin_data
FOR SELECT USING (
  auth.jwt() ->> 'role' = 'admin'
);
```

### Firebase

Firebase uses **Custom Claims** for roles.

```typescript
// Set admin claim (server-side with Admin SDK)
await admin.auth().setCustomUserClaims(uid, { admin: true });

// Check in security rules
{
  "rules": {
    "admin": {
      ".read": "auth.token.admin === true"
    }
  }
}
```

### Clerk

Clerk has **built-in roles and permissions**.

```typescript
// Check role in middleware
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isAdminRoute = createRouteMatcher(['/admin(.*)']);

export default clerkMiddleware((auth, req) => {
  if (isAdminRoute(req)) {
    auth().protect({ role: 'admin' });
  }
});
```

## Suggested Admin Features

These are features your team should implement (they are not in the template):

- [ ] **User management** — view all users, search, filter
- [ ] **Role management** — promote/demote users (admin ↔ user)
- [ ] **Content moderation** — review and manage user-generated content
- [ ] **Analytics dashboard** — real data from your database
  - Total users, new signups, active sessions
  - Revenue and subscription metrics
  - Feature usage statistics
- [ ] **System health** — API response times, error rates
- [ ] **Activity log** — who did what and when

## Implementation Checklist

- [ ] Choose an auth/BaaS provider (Supabase, Firebase, Clerk, etc.)
- [ ] Set up user roles in your auth system
- [ ] Protect the admin route in `middleware.ts`
- [ ] Add server-side role checks in admin pages
- [ ] Protect all admin API routes
- [ ] Replace placeholder data with real database queries
- [ ] Add user management functionality
- [ ] Test that non-admin users cannot access admin routes

## Useful Resources

- [Next.js Middleware](https://nextjs.org/docs/app/building-your-application/routing/middleware)
- [Supabase Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [Firebase Custom Claims](https://firebase.google.com/docs/auth/admin/custom-claims)
- [Clerk RBAC](https://clerk.com/docs/organizations/roles-permissions)
