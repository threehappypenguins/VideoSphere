<img width="150px" src="https://w0244079.github.io/nscc/nscc-jpeg.jpg" >

# PROG 5016 - Project - Overview & Requirements

> **Read this document carefully before writing a single line of code.**
> It defines what your team must build, what is already provided, and how your work will be assessed.

---

## What Is This Project?

This project is a **collaborative team-built SaaS web application**. Your team has been given a pre-approved project idea and this starter template as your foundation. Your goal is to build a real, working product on top of this template — from planning through to a live presentation.

The project is designed to give you hands-on experience with:

- **Professional development workflows** — branching, pull requests, code review, CI/CD
- **Agile team collaboration** — sprints, standups, retrospectives, continuous delivery
- **Full-stack web development** — frontend, backend, database, authentication, payments, and AI
- **Real-world tooling** — the same tools and practices used in industry today

The final product matters — but **how you built it matters just as much.**

---

## What Is Already Provided

This template gives your team a fully configured, professional starting point. You do **not** need to configure or set up any of the following — it is done for you:

| Area | What is provided |
|------|-----------------|
| **Framework** | Next.js 16 with App Router, TypeScript, Tailwind CSS |
| **Code Quality** | ESLint, Prettier, pre-configured with sensible defaults |
| **Git Hooks** | Husky + lint-staged — automatic linting on every commit |
| **Commit Standards** | Conventional Commits enforced via commitlint |
| **Testing** | Vitest + React Testing Library — configured, zero tests written |
| **CI Pipeline** | GitHub Actions — runs lint, format check, type check, and build on every PR |
| **Dev Container** | Optional VS Code Dev Container for consistent team environments |
| **Pages (UI shells)** | Landing, Pricing, About, Contact, Dashboard, Login, Signup, Profile, Admin Dashboard, 404, Error, Loading |
| **API Examples** | Health check and example route handlers demonstrating the pattern |
| **Documentation** | 20 guides in `/docs/` covering every technology decision made |
| **GitHub Workflow** | PR template, 4 issue templates, branch protection guide |

> ⚠️ The pages listed above are **UI shells only** — they render but contain no live functionality. Your team must implement the functionality.

---

## What Your Team Must Build

The following are **mandatory requirements** for every team. Every team implements all of them regardless of their project idea. The *how* is your team's decision — the *what* is not.

---

### Requirement 1: User Authentication

Every user of your application must be able to create an account and sign in.

**What this means:**
- Users can register with at least an email and password
- Users can log in and log out
- Authenticated state persists across page loads
- Certain pages and features are only accessible to signed-in users

**How to approach it:**
Your team must choose an authentication strategy. Your choice of backend service will heavily influence this decision. Refer to `/docs/admin-guide.md` and the documentation of your chosen BaaS for guidance.

**What is provided:**
Login and Signup pages exist as UI shells. `middleware.ts` exists as a documented stub showing where route protection goes. Nothing is wired up — your team implements everything.

---

### Requirement 2: Backend as a Service (BaaS) & Database

Your application must store and retrieve persistent data using a backend service and database.

**What this means:**
- Your project idea will naturally require data to be stored — users, content, records, etc.
- You must choose and integrate a BaaS provider (e.g. Supabase, AppWrite, Back4app, Firebase, PlanetScale, etc.)
- Your database structure must reflect the needs of your application

**How to approach it:**
Your choice of BaaS will also shape your authentication approach (Requirement 1). Choose early, agree as a team, and document the decision. Refer to environment variables guidance in `.env.example`.

**What is provided:**
Nothing — no database layer, no BaaS SDK, no schema. This is entirely your team's implementation.

---

### Requirement 3: Freemium Model with Payment Processing

Your application must offer a free tier and a premium tier. Users must be able to upgrade by completing a payment, which unlocks additional functionality.

**What this means:**
- Define what is available for free and what requires a paid upgrade
- Implement a payment flow that allows users to purchase the premium tier
- The application must detect a user's subscription status and conditionally show or hide premium features
- The Pricing page (already provided as a UI shell) must be wired up to your payment solution

**How to approach it:**
Use test mode throughout development — never process real payments. Refer to `/docs/payments.md` for provider options and integration guidance. Stripe is the recommended option.

**What is provided:**
The Pricing page UI shell and a placeholder subscription status section on the Profile page. No payment SDK, no webhook handling, no subscription logic — all your team's work.

---

### Requirement 4: AI-Powered Feature

Your application must include at least one AI-powered feature that meaningfully enhances the user experience or adds functionality.

**What this means:**
- The feature must be genuinely useful — not a gimmick
- It must be integrated into the product in a way that makes sense for your use case
- Examples include: a chatbot, content generation, smart search, recommendations, data summarization, image analysis, or similar

**How to approach it:**
Refer to `/docs/ai-features.md` for provider options, the Vercel AI SDK, and implementation patterns. OpenRouter is recommended as it provides free-tier access to multiple AI models through a single API.

**What is provided:**
Nothing — no AI SDK, no API routes for AI, no UI components. Entirely your team's work.

---

### Requirement 5: Admin Dashboard

Your application must include a protected admin area accessible only to users with an admin role.

**What this means:**
- A designated admin user can access the admin dashboard
- Regular users cannot access the admin dashboard under any circumstances
- The admin dashboard must display meaningful, real data from your application
- Route protection must be implemented properly — client-side checks alone are not sufficient

**How to approach it:**
The admin dashboard page (`/admin/dashboard`) exists as an unprotected UI shell. Your team must implement role-based access control (RBAC) using `middleware.ts` and server-side checks. Refer to `/docs/admin-guide.md` for detailed guidance.

**What is provided:**
The Admin Dashboard UI shell with placeholder stat cards and a data table. `middleware.ts` stub showing where protection logic goes. No protection, no real data, no role checking — all your team's work.

---

### Requirement 6: Responsive Design

Your application must work correctly and look professional on mobile, tablet, and desktop screen sizes.

**What this means:**
- All pages must be usable on mobile devices
- Navigation must adapt to small screens
- No content should overflow or be inaccessible on any common screen size

**How to approach it:**
The template is already built mobile-first using Tailwind CSS. Maintain this approach as you build. Refer to `/docs/styling.md`.

**What is provided:**
The starter template is fully responsive. Your team must maintain and extend this responsiveness as you add pages and features.

---

### Requirement 7: Project Idea Implementation

Your application must deliver the core functionality of your team's approved project idea.

**What this means:**
- Your application must do something useful and specific to your approved idea
- Users must be able to interact with the core feature(s) of your product — not just view placeholder UI
- The functionality must be connected to your database (Requirement 2) and respect your authentication model (Requirement 1)
- The application should feel like a real product, not a demo

**What complexity is expected:**
This requirement does **not** demand a massively complex feature set. A focused, well-executed core feature is far more valuable than many half-built ones. Ask yourself: *what is the one thing a user comes to this app to do?* Build that well.

For example:
- A task management app where users can create, view, and complete tasks ✅
- A recipe app where users can save and browse recipes ✅
- A booking app where users can make and view reservations ✅

You are not building enterprise software. You are building a working proof of concept that demonstrates your idea clearly and functions reliably.

**How to approach it:**
Define your core feature early — ideally in your first sprint. Everything else (auth, payments, AI, admin) wraps around this core. If your core feature isn't working, none of the other requirements feel meaningful.

**What is provided:**
The Dashboard page exists as an empty shell — this is typically where your core application functionality will live once users are signed in. The structure is yours to build.

---

## Development Process Requirements

Beyond the product itself, your team will be assessed on **how you work**. The following process requirements are mandatory:

### Git Workflow

- All work must happen on **feature branches** — direct commits to `main` are prohibited
- Branch protection rules must be configured on `main` before any development begins (see `SETUP.md`)
- Every feature must go through a **pull request** with at least one team member review before merging
- All commits must follow the **Conventional Commits** standard — this is enforced automatically

Refer to `/docs/git-workflow.md` and `CONTRIBUTING.md`.

### Pull Requests

- Every PR must use the provided PR template
- PRs must pass all CI checks before merging
- PRs must receive at least one approving review
- ⚠️ **All git operations — commits, pushes, merges, PR creation — must be performed by a human team member. AI agents performing git operations will result in a grade penalty.**

### Agile Process

- Your team must use **GitHub Projects** to manage work as a Kanban board
- Work must be tracked as GitHub Issues using the provided issue templates
- Your team should work in **short sprints (2-3 days)** given the project timeline
- **Features are assessed continuously** — present completed work to your instructor as you build, not all at the end

Refer to `/docs/agile-process.md`.

### AI Tool Usage

- GitHub Copilot is strongly encouraged — all students have access
- Your team must agree on which AI tools you will use and document this decision
- You must be able to explain any code in your codebase — inability to explain AI-generated code is a problem
- ⚠️ **No AI agent may perform any git operation. All commits must be made by a human.**

Refer to `/docs/ai-usage-policy.md`.

---

## Assessment

### How Your Work Is Evaluated

Your project will be assessed in two ways:

**1. Continuous assessment during development**
As your team completes features, you will present them to your instructor for feedback and assessment. Do not wait until the end — demonstrate work as it is ready.

**2. Final live presentation — April 13 or 15**
Your team will present the complete, working application live. Be prepared to:
- Demo all implemented features
- Walk through your codebase and explain your decisions
- Discuss your development process (branches, PRs, sprints)
- Answer questions about any code in your project

### What Contributes to Your Grade

| Area | What is assessed |
|------|-----------------|
| **Mandatory requirements** | All 7 requirements implemented and working (~80% of project portion of overall grade) |
| **Development process** | Branch usage, commit quality, PR descriptions, code reviews |
| **Agile practice** | Issue tracking, sprint discipline, GitHub Projects usage |
| **Code quality** | ESLint passing, Prettier formatting, TypeScript usage |
| **Documentation** | README updated, placeholder content replaced, relevant docs updated |
| **Presentation** | Live demo, ability to explain decisions and code |
| **Stretch goals** | Number and quality of completed items from `STRETCH_GOALS.md` (~20% of the project requirements portion of your grade) |

### Stretch Goals — Add-On Mark Component

Approximately **20% of the project requirements portion of your grade** is determined by the number and quality of stretch goals your team completes from [`STRETCH_GOALS.md`](STRETCH_GOALS.md).

**How it works:**
- Each completed stretch goal is assessed independently — present them to your instructor as they are done, not all at once at the end.
- Every attempt must go through the normal process: a GitHub Issue, a feature branch, a pull request, passing CI, and a code review.
- Stretch goals are scored on **quality and understanding**, not just completion. Be prepared to explain every implementation decision.
- Attempting items across **multiple categories** is valued over going deep in only one area.

**The list covers 20 categories**, including:

| Category | Example Items |
|----------|---------------|
| UI & UX | Dark mode, page transitions, skeleton states, command palette |
| Frontend Architecture | Storybook, custom hooks, form validation, optimistic UI |
| Auth — Advanced | OAuth login, MFA, magic links, session management |
| Backend & API | Zod validation, OpenAPI docs, Server Actions, DB migrations |
| Real-Time | Live updates, presence indicators, Server-Sent Events |
| File Handling | Cloud file upload, avatar crop, image optimisation |
| Email & Notifications | Transactional email, web push, notification centre |
| Search | Full-text search, autocomplete, Algolia/Meilisearch |
| AI — Advanced | Streaming responses, tool calling, RAG, usage metering |
| Payments — Advanced | Customer portal, usage billing, invoice history |
| Admin — Advanced | User management UI, audit log, data export |
| Performance | Bundle analysis, Core Web Vitals, edge runtime |
| SEO | Dynamic OG images, sitemap, JSON-LD structured data |
| PWA | Web App Manifest, service worker, offline support |
| Testing | E2E with Playwright, axe-core, coverage threshold |
| Accessibility | WCAG AA audit, keyboard nav, colour contrast, live regions |
| Security | CSP, rate limiting, input sanitisation, env audit |
| DevOps & CI/CD | Auto-deploy, Sentry, Dependabot, expanded pipeline |
| Internationalisation | Multi-language support, RTL layout |
| Developer Experience | JSDoc, ADRs, path aliases, pre-push hook |

See [`STRETCH_GOALS.md`](STRETCH_GOALS.md) for the complete checklist with full descriptions of every item.

---

## Project Timeline

| Date | Milestone |
|------|-----------|
| **March 2** | Project begins — complete `SETUP.md` on day one |
| **March 2-4** | Team aligned, GitHub Projects set up, Sprint 1 planned, first feature branches open |
| **Ongoing** | 2-3 day sprints, continuous feature presentation to instructor |
| **April 13** | Final live presentation — complete working application |

> The timeline is tight. Short sprints, early decisions, and steady incremental delivery are essential. Do not leave mandatory requirements until the final week.

---

## Key Documents

| Document | Purpose |
|----------|---------|
| [`SETUP.md`](SETUP.md) | ⭐ Start here — first-run setup checklist |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Team workflow, branching, commit standards |
| [`STRETCH_GOALS.md`](STRETCH_GOALS.md) | Stretch goals — the add-on mark component (~20%) |
| [`docs/git-workflow.md`](docs/git-workflow.md) | Feature branch workflow guide |
| [`docs/agile-process.md`](docs/agile-process.md) | Sprint structure and GitHub Projects |
| [`docs/ai-usage-policy.md`](docs/ai-usage-policy.md) | ⚠️ AI tool rules — read carefully |
| [`docs/payments.md`](docs/payments.md) | Payment processing guidance |
| [`docs/ai-features.md`](docs/ai-features.md) | AI feature implementation guidance |
| [`docs/admin-guide.md`](docs/admin-guide.md) | RBAC and admin route protection |
| [`docs/testing.md`](docs/testing.md) | Testing guidance and Vitest setup |
| [`docs/deployment-guide.md`](docs/deployment-guide.md) | Deployment options and guidance |

---

## Quick Reference: What To Do First

1. Read `SETUP.md` and complete every step before writing any code
2. Read this document as a team — make sure everyone understands all 7 requirements
3. Read `/docs/ai-usage-policy.md` — everyone must understand the AI rules
4. Set up GitHub Projects and create your first sprint
5. Make your first feature branch — even if it's just replacing placeholder branding

---

*This document describes what your team must deliver. The how is yours to decide — that creative and technical decision-making is part of what you are being assessed on.*
