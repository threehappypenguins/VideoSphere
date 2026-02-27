# Agile Process Guide

## Agile in a 6-Week Student Project

Agile is a set of principles for delivering software iteratively — in small, working increments. Instead of planning everything upfront and delivering at the end, you build, test, and present features continuously.

This project runs from **March 2 to April 13** (~6 weeks). You'll use a simplified Agile process adapted for a small team on a compressed timeline.

## Sprint Length: 2-3 Days

**Recommended sprint length: 2-3 days** (not 2 weeks like industry).

Why so short?

- **Compressed timeline** — 6 weeks total, so you need fast iteration
- **AI-accelerated development** — with Copilot, you can build faster than you think
- **Maximizes process repetition** — more sprints = more practice with the Agile workflow
- **Faster feedback** — present features sooner, catch issues earlier

With 2-3 day sprints, you'll complete approximately **13-14 sprints** across the project.

## Project Timeline

| Week   | Dates        | Focus                                          |
| ------ | ------------ | ---------------------------------------------- |
| Week 1 | Mar 2-8      | Setup, branding, basic UI, first feature PRs   |
| Week 2 | Mar 9-15     | Auth implementation, core CRUD                 |
| Week 3 | Mar 16-22    | Payment integration, feature gating            |
| Week 4 | Mar 23-29    | AI feature implementation                      |
| Week 5 | Mar 30-Apr 5 | Admin dashboard, RBAC, polish                  |
| Week 6 | Apr 6-13     | Testing, bug fixes, final polish, presentation |

This is a suggestion — your team decides the actual order.

## Sprint Structure

Each 2-3 day sprint follows this cycle:

### 1. Sprint Planning (Start of Sprint)

- Look at your product backlog (list of all remaining work)
- Select issues for this sprint based on priority and capacity
- Break large issues into smaller tasks if needed
- Assign issues to team members
- Move selected issues to "In Progress" on your board

### 2. Daily Async Standup

Post a brief update in your team's communication channel (Slack, Discord, etc.):

```
What I did: [completed tasks]
What I'm doing: [current tasks]
Blockers: [anything stopping progress]
```

Keep it short. The purpose is team awareness, not a formal meeting.

### 3. Sprint Review (End of Sprint)

- **Demo completed features to the instructor** for assessment
- Show working software, not slides
- Get feedback and note adjustments needed
- Each team member presents the features they built

### 4. Sprint Retrospective (End of Sprint)

Quick team discussion (5-10 minutes):

- **What went well?** — keep doing this
- **What didn't go well?** — what to improve
- **What will we try differently?** — concrete action for next sprint

## Continuous Assessment

This project uses **continuous assessment** rather than a single final grade:

- **Present completed features as they are done** — don't wait until the end
- The instructor evaluates working features during sprint reviews
- Earlier presentations mean earlier feedback and more time to improve
- **Final presentation on April 13** — live demo of the complete application

## GitHub Projects (Kanban Board)

Use GitHub Projects to track your work visually.

### Setting Up Your Board

1. Go to your repository on GitHub
2. Click the **Projects** tab
3. Click **New project** → choose **Board** template
4. Name it something like "Sprint Board"

### Column Setup

Create these columns:

| Column          | Purpose                            |
| --------------- | ---------------------------------- |
| **Backlog**     | All future work, not yet scheduled |
| **Sprint**      | Selected for the current sprint    |
| **In Progress** | Currently being worked on          |
| **In Review**   | PR opened, awaiting review         |
| **Done**        | Merged to main, feature complete   |

### Adding Issues to the Board

1. Create issues in your repository using the templates provided
2. Add them to your project board
3. Drag issues between columns as work progresses

## Writing User Stories

Write issues as user stories with acceptance criteria:

```
## User Story
As a [type of user],
I want to [perform an action],
so that [I achieve a goal].

## Acceptance Criteria
- [ ] User can [specific testable behavior]
- [ ] [Another specific testable behavior]
- [ ] [Edge case is handled]

## Technical Notes
- Suggested approach: [brief technical guidance]
- Related files: [relevant file paths]

## Size
[ ] Small (< 2 hours)
[ ] Medium (2-4 hours)
[ ] Large (4-8 hours)
```

## Definition of Done

A feature is **Done** when:

- [ ] Code is complete and working
- [ ] Code passes all lint and format checks
- [ ] Feature works on mobile and desktop
- [ ] PR has been reviewed and approved by at least 1 team member
- [ ] PR has been merged to `main`
- [ ] CI pipeline passes
- [ ] Feature has been demonstrated to the instructor

## Using AI in the Sprint Workflow

AI tools like GitHub Copilot accelerate your sprints, but use them responsibly:

1. **Planning**: Use AI to help break down user stories into technical tasks
2. **Implementation**: Use AI to write code, but understand every line before committing
3. **Review**: AI-generated code still requires human PR review
4. **Commit**: ALL git operations must be performed by a human team member (see AI Usage Policy)

Read the full AI policy: [AI Usage Policy](/docs/ai-usage-policy.md)

## Tips for Success

- **Start small** — your first sprint should be simple (branding, one page)
- **Don't overcommit** — it's better to finish 3 issues than to half-finish 6
- **Communicate blockers early** — don't wait until the sprint review to mention problems
- **Present early and often** — get credit for completed work as you go
- **Use the templates** — issue templates, PR template, and commit conventions exist for a reason

## Useful Resources

- [GitHub Projects Documentation](https://docs.github.com/en/issues/planning-and-tracking-with-projects)
- [Agile Manifesto](https://agilemanifesto.org/)
- [Writing Good User Stories](https://www.atlassian.com/agile/project-management/user-stories)
