# AI Usage Policy

## Overview

AI coding assistants are **strongly encouraged** in this project. They accelerate development and help you learn new patterns. However, there is one absolute rule that cannot be broken.

---

## ⚠️ HARD RULE — READ THIS CAREFULLY

> **Every single commit to every branch in your repository MUST be performed by a human team member using standard git operations.**
>
> **AI agents must NEVER perform any git operations of any kind** — this includes:
>
> - Commits
> - Pushes
> - Pulls
> - Merges
> - Branch creation
> - PR creation
> - Any other GitHub activity
>
> **Any evidence that an AI agent performed git or GitHub operations will result in a team grade penalty.**
>
> **There are no exceptions to this rule.**

This means: AI writes code in your editor → YOU review it → YOU stage it → YOU commit it → YOU push it.

---

## Recommended AI Tool

**GitHub Copilot** is strongly encouraged as the primary AI coding assistant. All students have access through GitHub Education.

Teams may use other AI tools (ChatGPT, Claude, Cursor, etc.) but must:

1. **Agree as a team** on which tools to use
2. **Document the decision** using the agreement template below
3. **Be consistent** — the whole team should use the same tools

## Team AI Agreement

Complete this agreement as a team during initial setup (SETUP.md Step 6):

```
┌──────────────────────────────────────────────────────────────┐
│                    TEAM AI AGREEMENT                         │
│                                                              │
│  Our team agrees to use: [tool/model name]                   │
│                                                              │
│  We will use it for:                                         │
│  - [specific use cases, e.g., code generation, debugging]    │
│  - [e.g., writing tests, documentation]                      │
│                                                              │
│  We will NOT use it for:                                     │
│  - Git operations (commits, pushes, PRs, merges, etc.)       │
│  - [any other team-specific restrictions]                    │
│                                                              │
│  Agreed by:                                                  │
│  - [Name] — [Date]                                           │
│  - [Name] — [Date]                                           │
│  - [Name] — [Date]                                           │
│  - [Name] — [Date]                                           │
└──────────────────────────────────────────────────────────────┘
```

Replace the bracketed text with your team's actual decisions and save this file.

## Code Ownership

AI is a **coding assistant** — you are the **developer**.

- You must **read and understand every line** of AI-generated code before committing it
- During presentations, the instructor will **ask you about your code**
- If you can't explain code you committed, that's a problem
- AI-generated code still requires **human PR review** from a teammate

## Responsible AI Usage Guidelines

### Be Specific in Prompts

```
❌ "Make a login page"
✅ "Create a login form component using React with email and password fields,
    client-side validation, and Tailwind CSS styling that matches our existing design"
```

### Verify AI Output

AI can and does produce incorrect code. Always:

- **Test the code** — does it actually work?
- **Check for security issues** — does it expose data? Does it validate input?
- **Verify imports** — are all packages actually installed?
- **Review logic** — does the approach make sense for your use case?

### Use AI to Learn

```
✅ "Explain how React Server Components differ from Client Components"
✅ "Why would I use useCallback here?"
✅ "What does this TypeScript error mean?"

❌ Just copying/pasting without reading
❌ Using AI to avoid understanding the code
```

### Document Non-Trivial AI Contributions

When AI helps with a complex solution, add a brief comment:

```tsx
// AI-assisted: Using intersection observer pattern for infinite scroll
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API
```

## What's Allowed vs. Not Allowed

| Action                           | Allowed?  |
| -------------------------------- | --------- |
| AI writes code in your editor    | ✅ Yes    |
| AI helps debug an error          | ✅ Yes    |
| AI generates test cases          | ✅ Yes    |
| AI explains a concept or pattern | ✅ Yes    |
| AI helps write documentation     | ✅ Yes    |
| Human commits AI-generated code  | ✅ Yes    |
| AI performs `git commit`         | ❌ **No** |
| AI performs `git push`           | ❌ **No** |
| AI creates a branch              | ❌ **No** |
| AI opens a Pull Request          | ❌ **No** |
| AI merges a PR                   | ❌ **No** |
| AI performs any GitHub operation | ❌ **No** |

## Summary

1. **Use AI tools** — they make you faster and help you learn
2. **Agree as a team** on which tools to use
3. **Understand every line** you commit
4. **NEVER let AI touch git** — all git operations are human-only
