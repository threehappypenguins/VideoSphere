// =============================================================================
// SIGNUP PAGE
// =============================================================================
// Signup form UI — NO authentication logic is implemented.
//
// STUDENT: You MUST implement authentication yourself. This is just a UI shell.
//
// What you need to do:
//   1. Choose an auth provider (Supabase Auth, Firebase Auth, Clerk, NextAuth, etc.)
//   2. Follow their documentation to implement the signup flow
//   3. Wire up the form submission to your auth provider's signup method
//   4. Add proper validation (password strength, matching passwords, etc.)
//   5. Handle errors (email already exists, weak password, etc.)
//   6. Redirect to /dashboard or show a verification message on success
//
// This form currently does NOTHING when submitted. It only shows a console log.
// =============================================================================

'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function SignupPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  // STUDENT: Replace this with your actual auth provider's signup method
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Basic client-side validation example
    if (formData.password !== formData.confirmPassword) {
      alert('Passwords do not match.');
      return;
    }

    // TODO: STUDENT: Implement authentication signup
    console.log('Signup attempted (not implemented yet):', formData.email);
    alert('Authentication is not yet implemented. See the code comments for guidance.');
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground">Create your account</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Get started with [Your App Name] today
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          {/* Name */}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-foreground">
              Full name
            </label>
            <input
              type="text"
              id="name"
              name="name"
              autoComplete="name"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="mt-2 block w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Jane Doe"
            />
          </div>

          {/* Email */}
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-foreground">
              Email address
            </label>
            <input
              type="email"
              id="email"
              name="email"
              autoComplete="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="mt-2 block w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="you@example.com"
            />
          </div>

          {/* Password */}
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-foreground">
              Password
            </label>
            <input
              type="password"
              id="password"
              name="password"
              autoComplete="new-password"
              required
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="mt-2 block w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="••••••••"
            />
          </div>

          {/* Confirm Password */}
          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground">
              Confirm password
            </label>
            <input
              type="password"
              id="confirmPassword"
              name="confirmPassword"
              autoComplete="new-password"
              required
              value={formData.confirmPassword}
              onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              className="mt-2 block w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="••••••••"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Create account
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-primary hover:text-primary/90">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
