# Auto Request Reviews

## Overview

The **Auto Request Reviews** workflow automatically assigns pull request reviewers whenever a PR is opened or updated with new commits. This ensures every PR gets timely peer review without manual reviewer assignment.

## How It Works

### Trigger Events

The workflow runs when:

- **A pull request is opened** — reviewers are assigned immediately.
- **New commits are pushed to an existing PR** (`synchronize`) — reviewers are re-assigned, picking up any new team members added since the last run.

### Reviewer Selection

The workflow dynamically determines eligible reviewers at runtime using two lookup methods:

1. **Direct collaborators** — Fetches all repository collaborators via the GitHub API and filters to those with **write (push)**, **maintain**, or **admin** permissions.
2. **Team members (fallback)** — If no direct collaborators are found, the workflow lists all GitHub teams with access to the repo, then fetches members of teams that have push, maintain, or admin permission.

### Excluded Users

The following users are **always excluded** from automatic review assignment:

| User | Reason |
| --- | --- |
| PR author | Cannot review your own pull request |
| `w0244079` | Excluded by configuration (course instructor) |

### Reviewer List Is Always Fresh

The reviewer list is **never cached**. Every time the workflow runs, it fetches the current list of collaborators/team members from the GitHub API. If a new member is added to the repo or a team between runs, they will be included on the next PR event.

## Prerequisites

### `REVIEW_TOKEN` Secret

The workflow requires a Personal Access Token (PAT) stored as an **organization secret** named `REVIEW_TOKEN`. The default `GITHUB_TOKEN` does not have sufficient permissions to list collaborators or team members in organization-owned repositories.

#### Creating the Token

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)**.
2. Create a new token with the following scopes:
   - `repo` — Full control of private repositories
   - `read:org` — Read org and team membership
3. Set an appropriate expiration.
4. Copy the token value.

#### Storing as an Organization Secret

1. Go to your organization settings: **Organization → Settings → Secrets and variables → Actions**.
2. Click **New organization secret**.
3. Name: `REVIEW_TOKEN`
4. Value: Paste the PAT.
5. Repository access: Select **All repositories** or choose specific repositories.
6. Save.

> **Note:** If the token expires, the workflow will fail silently (no reviewers assigned). Ensure the token is rotated before expiration.

## Workflow File

The workflow is defined in:

```
.github/workflows/auto-request-reviews.yml
```

## Troubleshooting

| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| "No eligible reviewers found." | `REVIEW_TOKEN` is missing, expired, or lacks required scopes | Regenerate the PAT with `repo` and `read:org` scopes and update the secret |
| `listCollaborators failed: Resource not accessible by integration` | Using `GITHUB_TOKEN` instead of `REVIEW_TOKEN`, or the PAT lacks permissions | Ensure the workflow references `secrets.REVIEW_TOKEN` |
| `Teams lookup failed: Resource not accessible by integration` | PAT is missing the `read:org` scope | Regenerate the PAT with `read:org` scope |
| New team member not getting assigned | They were added after the last workflow run | Push a new commit to an open PR, or close and reopen the PR to trigger the workflow |
| PR author is being assigned as reviewer | Bug — should not happen | Check that `prAuthor` is correctly added to `excludedUsers` |
