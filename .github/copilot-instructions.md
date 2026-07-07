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

## Quality Expectations

- Keep suggestions consistent with the repository's style and architecture.
- Prefer clarity and maintainability over clever one-off patterns.
- Keep changes focused and avoid unrelated modifications.

## Vimeo Draft Metadata UX (Do Not Re-Suggest)

- **License picker:** Vimeo’s upload UI uses **“Select a license…”** for the no–Creative Commons
  choice. There is **no** “All Rights Reserved” option in Vimeo’s UI. Do not suggest renaming
  the sentinel to “All Rights Reserved”.
- **`license: null` vs `undefined`:** `null` is an explicit no-CC override; `undefined` means
  no draft override (inherit/display account default). Both may show the same Vimeo label in
  the select; that is intentional UI parity, not a bug. Do not suggest splitting into
  “All Rights Reserved” vs “Not selected” unless product explicitly requests Vimeo-parity changes.
- **Content rating:** See `VimeoDraftFields.contentRating` docs for `[]` as a Mature-tier
  draft placeholder.

Reference:
- [GitHub repository instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions)
- [Repository agent rules](../AGENTS.md)
