// =============================================================================
// CONTACT PAGE
// =============================================================================
// A contact form for visitors to reach out.
//
// STUDENT: This form is UI only — the submit button does NOT send any data.
// You must implement the form submission yourself. Options include:
//   - A Next.js API route that sends an email (see /docs/api-routes.md)
//   - A Server Action that processes the form
//   - A third-party form service (Formspree, Resend, etc.)
//
// The form uses a Client Component because it needs to handle user input state.
// =============================================================================

'use client';

import { useState } from 'react';

// Note: metadata export cannot be used in Client Components.
// If you need metadata for this page, move the form to a separate
// Client Component and keep this page file as a Server Component.

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    message: '',
  });

  // STUDENT: Implement this function to actually send the form data.
  // See /docs/api-routes.md for guidance on creating an API endpoint.
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: STUDENT: Implement form submission
    // Example: send to /api/contact or use a Server Action
    console.log('Form submitted (not implemented yet):', formData);
    alert('Form submission is not yet implemented. See the code comments for guidance.');
  };

  return (
    <div className="px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl">
        {/* --- Header --- */}
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Get in Touch
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            [Have a question or want to learn more? Fill out the form below and we&apos;ll get back
            to you as soon as possible.]
          </p>
        </div>

        {/* --- Contact Form --- */}
        <form onSubmit={handleSubmit} className="mt-12 space-y-6">
          {/* Name Field */}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-foreground">
              Name
            </label>
            <input
              type="text"
              id="name"
              name="name"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="mt-2 block w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Your name"
            />
          </div>

          {/* Email Field */}
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-foreground">
              Email
            </label>
            <input
              type="email"
              id="email"
              name="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="mt-2 block w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="you@example.com"
            />
          </div>

          {/* Message Field */}
          <div>
            <label htmlFor="message" className="block text-sm font-medium text-foreground">
              Message
            </label>
            <textarea
              id="message"
              name="message"
              required
              rows={5}
              value={formData.message}
              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
              className="mt-2 block w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="How can we help you?"
            />
          </div>

          {/* Submit Button */}
          {/* STUDENT: This button currently only logs to console.
              You must wire it up to a backend endpoint. */}
          <button
            type="submit"
            className="w-full rounded-lg bg-primary px-8 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Send Message
          </button>
        </form>
      </div>
    </div>
  );
}
