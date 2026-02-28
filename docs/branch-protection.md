# Branch Protection Configuration

This document describes the branch protection rules configured on the `main` branch of this repository and explains why each rule matters for team-based development.

Branch protection is configured by the **instructor** (repository Admin) in **Settings → Branches → Branch protection rules** on GitHub. These rules apply to the `main` branch and cannot be bypassed by any contributor.

> **Reference:** [About protected branches — GitHub Docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

---

## Enabled Rules

### 1. Require a Pull Request Before Merging

All commits must be made to a non-protected branch and submitted via a pull request before they can be merged into `main`.

**Why this matters:**
- Prevents direct pushes to `main`, which could introduce untested or unreviewed code into the production branch.
- Forces every change — no matter how small — to go through the standard PR workflow, creating a clear audit trail of what changed and why.
- Aligns with the feature-branching strategy described in [docs/git-workflow.md](git-workflow.md).

---

### 2. Require Approvals (2 Required)

Pull requests targeting `main` require **two approving reviews** before they can be merged.

**Why this matters:**
- Ensures at least two team members have examined the code, increasing the chance of catching bugs, logic errors, and style inconsistencies.
- Distributes knowledge across the team — at least two people will be familiar with every change that reaches `main`.
- Two approvals (rather than one) provide a higher quality bar appropriate for a production branch.

> **Team engagement is not optional.** Code reviews exist not just as a quality gate, but as the primary mechanism for keeping every team member informed about what is being built. Reviewing pull requests is how you stay connected to the project — you learn what your teammates are working on, understand how the codebase is evolving, and stay prepared to work in any area of the application.
>
> **Every team member is expected to:**
> - **Actively review PRs** — not just approve them, but read the code, ask questions, and leave meaningful feedback.
> - **Stay current** — if PRs are sitting without reviews, the team stalls. Timely reviews keep the project moving.
> - **Learn from each other** — reviews are a two-way learning opportunity. The reviewer learns about new code; the author learns from the feedback.
>
> A team member who never reviews PRs is disconnected from the project. Continuous engagement through code review is a core expectation of this course and of professional software development.

---

### 3. Dismiss Stale Pull Request Approvals When New Commits Are Pushed

If new commits are pushed to a branch after it has been approved, any existing approvals are automatically dismissed and fresh reviews must be submitted.

**Why this matters:**
- Prevents a scenario where a PR is approved based on an earlier version of the code, then additional (potentially problematic) commits are sneaked in before merging.
- Guarantees that every approval reflects the **actual final state** of the code being merged.
- This is a critical safeguard — without it, the "2 required approvals" rule can be undermined by post-approval changes.

---

### 4. Require Status Checks to Pass Before Merging

Commits must first be pushed to a non-protected branch and pass all configured status checks (CI jobs) before the PR can be merged.

**Why this matters:**
- Ensures automated quality gates — linting, type-checking, formatting, and tests — all pass before code reaches `main`.
- Catches regressions and errors that human reviewers might miss.
- Status checks are defined by the CI pipeline (see [docs/ci-cd-requirements.md](ci-cd-requirements.md)). Common checks include:
  - `lint` — ESLint passes with no errors
  - `type-check` — TypeScript compiles with no errors
  - `format:check` — Prettier formatting is correct
  - `test` — Vitest tests pass
  - `check-for-link-to-issue` — PR body contains a linked issue with a valid close keyword (e.g., `Closes #42`)

> **Reference:** [GitHub REST API — Required Status Checks](https://docs.github.com/en/rest/branches/branch-protection#update-status-check-protection)

---

### 5. Require Branches to Be Up to Date Before Merging

Pull requests targeting `main` must be tested with the **latest code from `main`** before they can be merged. This setting works in conjunction with the required status checks above.

**Why this matters:**
- Prevents a class of bugs caused by **merge skew** — where two PRs each pass CI independently, but their combined changes conflict or break when merged together.
- Example: PR A renames a function, PR B calls the old name. Both pass CI on their own, but merging both into `main` would produce a runtime error. This rule forces PR B to rebase/merge `main` and re-run CI before merging.
- While this can mean more frequent rebases, the tradeoff is a `main` branch that is always in a known-good state.

**How to bring your branch up to date:**

If GitHub shows "This branch is out-of-date with the base branch", do the following:

```bash
# Make sure main is current
git checkout main
git pull origin main

# Switch back to your feature branch and merge main into it
git checkout feature/your-branch-name
git merge main

# Resolve any merge conflicts if they arise, then push
git push origin feature/your-branch-name
```

Afterwards, the status checks will run again against your branch with the latest `main` code included. The PR can only be merged once those checks pass.

---

### 6. Require Conversation Resolution Before Merging

All review conversations (comments and threads) on a pull request must be marked as resolved before the PR can be merged.

**Why this matters:**
- Ensures that reviewer feedback is explicitly addressed rather than ignored or forgotten.
- Every comment thread represents a question, concern, or suggestion that deserves a response — either a code change or an explanation of why no change is needed.
- Creates accountability: the PR author must resolve each thread, and reviewers can verify their feedback was handled before the merge.

---

## Rules Not Currently Enabled

The following branch protection settings are available on GitHub but are **not enabled** in this repository. They are documented here for awareness:

| Setting | Description | Why Not Enabled |
|---|---|---|
| **Require signed commits** | All commits must have a verified GPG/SSH signature. | Adds setup complexity; not required for this course. |
| **Require linear history** | Prevents merge commits; forces rebase or squash merges only. | Team uses standard merge commits for simplicity. |
| **Require merge queue** | PRs enter a queue and are tested in sequence before merging. | More relevant for high-traffic repositories with many concurrent PRs. |
| **Require deployments to succeed** | A deployment environment must report success before merging. | No deployment environment is configured as a required check currently. |
| **Lock branch** | Makes the branch read-only (no new pushes or merges at all). | `main` needs to accept merges from approved PRs. |
| **Allow force pushes** | Allows force-pushing to the protected branch. | Disabled (default) — force pushes to `main` would rewrite history and are dangerous. |
| **Allow deletions** | Allows the protected branch to be deleted. | Disabled (default) — `main` should never be deleted. |

---

## How to Modify These Rules

Branch protection settings are configured and managed by the **instructor**, who serves as the repository Admin for all project repositories. Students cannot modify these rules.

If you believe a rule needs to be adjusted, contact your instructor to discuss. See [SETUP.md](../SETUP.md) (Step 4) for an overview of the protections in place.

> Changes to branch protection rules take effect immediately and apply to all open and future pull requests targeting the protected branch.
