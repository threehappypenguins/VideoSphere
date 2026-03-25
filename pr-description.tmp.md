## Description

Implements the AI metadata generation feature end-to-end. This PR adds:

- **`lib/ai/openrouter.ts`** — a typed OpenRouter client that sends chat completion requests and parses the response into a validated `GeneratedMetadata` object (`title`, `description`, `tags`)
- **`app/api/ai/generate-metadata/route.ts`** — `POST /api/ai/generate-metadata` that authenticates the user, selects a model based on supporter tier, derives the most restrictive character limits across the requested platforms, builds a video SEO system prompt, calls OpenRouter, and truncates the response to platform limits as a defense-in-depth measure (Issue #39)
- **`components/DraftWizard.tsx`** — wires the "Generate with AI" button to the correct endpoint and request shape; surfaces real API error messages in the toast instead of a generic fallback

## Related Issue

<!-- Link the issue this PR addresses: Closes #[issue number] -->

## Type of Change

- [x] New feature (`feat`)
- [x] Bug fix (`fix`)

## How Has This Been Tested?

52 unit tests added across two new test files:

- **`__tests__/lib/openrouter.test.ts`** (23 tests) — covers the OpenRouter client: missing API key, successful request structure and header values, default env var fallbacks, HTTP 429 rate limiting, non-OK responses with JSON/text/statusText error bodies, network failures, invalid JSON response body, empty choices, and all AI content validation cases (wrong type for title/description/tags, null, array)
- **`__tests__/api/ai/generate-metadata.test.ts`** (29 tests) — covers the API route: 401 unauthenticated, 400 for all invalid input combinations, 404 user not found, 500 missing model config, tier-based model selection (free vs premium), platform limit calculation (YouTube, Vimeo, both), system prompt and user message content, 200 successful generation, defense-in-depth title/description truncation, 429 rate-limit forwarding, and 502 error paths

All 52 tests pass (`pnpm test`).

The feature was also manually tested end-to-end in the DraftWizard UI:
- Selected platforms → typed a prompt → clicked "Generate with AI" → title, description, and tags populated correctly

## Screenshots

<!-- If this is a UI change, add before/after screenshots here -->

## Checklist

- [ ] My code follows the project style guidelines (ESLint + Prettier passing)
- [ ] I have reviewed my own code before requesting review
- [ ] I have added comments where the code is not self-explanatory
- [ ] My changes do not introduce new ESLint warnings
- [ ] I have updated relevant documentation if needed
- [ ] All commits in this PR follow the Conventional Commits standard
- [ ] ⚠️ I confirm that NO AI agent performed any git operations (commits, pushes, merges, branch creation) in this PR. All git operations were performed by a human team member.

## Ready for Review

- [ ] This PR is ready for team and/or instructor review
