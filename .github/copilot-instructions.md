# Copilot Repository Instructions

These instructions apply to GitHub Copilot suggestions in this repository.

## Required Behavior

### 1) Use Up-to-Date Documentation First

- Before suggesting code, verify APIs and patterns with MCP documentation sources.
- Use Context7 MCP as the primary source for current docs.
- Prefer latest stable, officially documented approaches.
- If there is uncertainty, re-check MCP docs before producing final code.

### 2) Do Not Suggest Deprecated Code

- Never suggest deprecated methods, properties, options, or patterns.
- Avoid legacy approaches when a current supported alternative exists.
- If existing code appears deprecated, suggest a modern replacement path.

### 3) Require TypeDoc for Public/Exported APIs

For all public-facing or exported code, include TypeDoc comments for:
- exported functions
- public components
- custom hooks
- exported types and interfaces

TypeDoc expectations by export kind:
- For exported functions/components/hooks and call signatures: include purpose/description, `@param` for all parameters, and `@returns` with return value details.
- For exported types/interfaces: include purpose/description and `@property` tags where property-level clarification is needed.

### 4) Never Perform Git or GitHub Operations

- Copilot/AI agents must never run git commands or perform GitHub actions.
- This includes commits, pushes, pulls, merges, rebases, branch operations, PR creation/edits, reviews, issue edits, and related GitHub activity.
- All git/GitHub operations are human-only.

## Quality Expectations

- Keep suggestions consistent with the repository's style and architecture.
- Prefer clarity and maintainability over clever one-off patterns.
- Keep changes focused and avoid unrelated modifications.

Reference:
- [GitHub repository instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions)
- [Repository agent rules](../AGENTS.md)
