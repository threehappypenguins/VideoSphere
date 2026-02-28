# First-Run Setup Guide

Complete these steps **immediately** after receiving your GitHub Classroom assignment. Do them in order — each step builds on the previous one.

---

## Step 1: Clone and Install

```bash
# Clone your team's repository
git clone [your-repo-url]
cd [your-repo-name]

# Install all dependencies
pnpm install

# Copy the environment variables template
cp .env.example .env.local
```

## Step 2: Verify It Runs

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. You should see the landing page with placeholder content.

**If it doesn't work:** Check the prerequisites in [README.md](README.md). You need Node.js ≥ 20 and pnpm installed.

## Step 3: Team Decides on a Maintainer

One team member takes the **Maintainer** role on the GitHub repository. This person will:

- Coordinate pull request reviews
- Help manage the project board
- Serve as the primary point of contact for repository workflow questions

> **Note:** The **instructor** is the Admin for all project repositories and manages repository settings, branch protection rules, and access permissions.

**Document this decision:**

- Who is the Maintainer? **\*\***\_\_\_**\*\***
- Date decided: **\*\***\_\_\_**\*\***

The remaining team members will have **Write** access to contribute code.

## Step 4: Branch Protection on `main`

The **instructor** configures branch protection on the `main` branch for all project repositories. This ensures all code goes through pull request review before merging.

You do **not** need to configure these rules yourself — they are already in place. However, you should understand what they enforce:

| Protection                                       | Setting     |
| ------------------------------------------------ | ----------- |
| **Require a pull request before merging**        | ✅ Enabled  |
| **Required number of approving reviews**         | 2           |
| **Require status checks to pass before merging** | ✅ Enabled  |
| **Status checks: select your CI workflow**       | ✅ Selected |
| **Do not allow bypassing the above settings**    | ✅ Enabled  |

**Why this matters:** Without branch protection, anyone can push directly to `main`, bypassing code review and CI checks. This is both a security risk and a process violation.

For a detailed explanation of each rule and why it is enabled, see [docs/branch-protection.md](docs/branch-protection.md). For CI/CD status checks that are enforced, see [docs/ci-cd-requirements.md](docs/ci-cd-requirements.md).

## Step 5: Verify Team Access

The instructor has already configured repository access. Verify that your team has the correct permissions:

- **1 team member** should have the **Maintainer** role (as decided in Step 3)
- **All other team members** should have **Write** access

If any team member cannot push branches or open pull requests, contact your instructor to resolve access issues.

## Step 6: Team Agrees on AI Tools

Read the [AI Usage Policy](docs/ai-usage-policy.md) together as a team.

Complete the **Team AI Agreement** in that document:

1. Decide which AI tool(s) your team will use
2. Agree on what you will and won't use AI for
3. Fill in the agreement template
4. Commit the completed agreement

> ⚠️ **Remember the hard rule:** AI must NEVER perform any git operations. All commits, pushes, PRs, and merges must be done by a human team member. See the full policy for details.

## Step 7: Set Up GitHub Projects Board

Follow the guide in [docs/agile-process.md](docs/agile-process.md) to set up your Kanban board:

1. Go to your repository → **Projects** tab
2. Create a new Board project
3. Set up columns: Backlog, Sprint, In Progress, In Review, Done
4. This is where you'll track all your work throughout the project

## Step 8: Create Sprint 1 Issues

Hold your first sprint planning session:

1. Decide on your product idea and branding
2. Create issues for Sprint 1 using the [issue templates](.github/ISSUE_TEMPLATE/)
3. Assign issues to team members
4. Move them to the "Sprint" column on your board

**Suggested Sprint 1 tasks:**

- Replace all `[Your App Name]` placeholders with your product name
- Update the logo and branding colors
- Customize the landing page content
- Set up your BaaS provider (Supabase, Firebase, or Clerk)

## Step 9: Replace Placeholder Branding

Search the project for `[Your App Name]` and replace it with your actual product name. Files that contain placeholders:

- [ ] `app/layout.tsx` — site title and description in metadata
- [ ] `components/layout/Navbar.tsx` — logo text and navigation links
- [ ] `components/layout/Footer.tsx` — brand name and links
- [ ] `app/(marketing)/page.tsx` — landing page content
- [ ] `app/(marketing)/pricing/page.tsx` — pricing page content
- [ ] `app/(marketing)/about/page.tsx` — about page content
- [ ] `public/logo.svg` — replace with your logo
- [ ] `.env.example` — app name variable

**Tip:** Use your editor's "Find and Replace" across all files (Cmd+Shift+H or Ctrl+Shift+H in VS Code) to find all instances of `[Your App Name]`.

## Step 10: Practice Run

Before starting real work, do a practice run of the full workflow:

1. Create a feature branch: `git checkout -b feat/practice-change`
2. Make a small change (e.g., update a heading on the landing page)
3. Commit with a conventional commit message: `git commit -m "feat: update landing page heading"`
4. Push the branch: `git push origin feat/practice-change`
5. Open a Pull Request on GitHub
6. Have a teammate review and approve it
7. Merge it to `main`

This ensures everyone understands the workflow **before** real development begins. Fix any issues now — not during Sprint 1.

---

## You're Ready!

Once all 10 steps are complete, your team is set up and ready to build. Start your Sprint 1 work by picking up the issues you created in Step 8.

**Key resources to keep handy:**

- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute code
- [docs/git-workflow.md](docs/git-workflow.md) — git branching workflow
- [docs/agile-process.md](docs/agile-process.md) — sprint process
- [docs/ai-usage-policy.md](docs/ai-usage-policy.md) — AI tool policy
