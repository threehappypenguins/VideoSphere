# AGENTS.md

This repository uses AI coding assistants. Follow these rules on every task.

## Core Rules

1. Check current documentation before writing or modifying code.
2. Do not introduce deprecated APIs, options, or patterns.
3. Document all exported/public APIs with TypeDoc comments.
4. Prefer maintainable, testable, and minimal changes that match existing project style.

## Documentation Requirements (Mandatory)

- Always verify library/framework/API usage against MCP documentation sources first.
- Use the Context7 MCP server as the default source for up-to-date docs.
- If uncertainty remains after checking docs, stop and re-check MCP sources before coding.
- Prefer latest stable best practices from official documentation.

References:
- [agents.md](https://agents.md/)

## Deprecated Code Policy (Mandatory)

- Never generate or suggest deprecated methods, properties, flags, or architectural patterns.
- If a currently used pattern appears deprecated, propose a non-deprecated replacement.
- Do not merge code that depends on deprecated behavior unless explicitly required by maintainers.

## TypeDoc Policy for Public/Exported Code (Mandatory)

TypeDoc-style comments are required for all public-facing exports, including:
- exported functions
- public components
- custom hooks
- exported types and interfaces

TypeDoc expectations by export kind:
- For exported functions/components/hooks and call signatures: include a clear description, `@param` for every parameter, and `@returns` describing the return value.
- For exported types/interfaces: include a clear description and `@property` tags when property-level clarification is needed.

Example:

```ts
/**
 * Builds the playback URL for a video asset.
 * @param videoId - Unique video identifier.
 * @param quality - Target playback quality label.
 * @returns Fully-qualified playback URL.
 */
export function buildPlaybackUrl(videoId: string, quality: string): string {
  return `/api/videos/${videoId}/playback?quality=${quality}`;
}
```
