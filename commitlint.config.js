// =============================================================================
// COMMITLINT CONFIGURATION
// =============================================================================
// Enforces Conventional Commits format on all commit messages.
// This runs automatically via a Husky git hook on every commit.
//
// Valid commit types:
//   feat:     A new feature
//   fix:      A bug fix
//   docs:     Documentation changes only
//   style:    Code style changes (formatting, semicolons, etc.)
//   refactor: Code changes that neither fix a bug nor add a feature
//   test:     Adding or updating tests
//   chore:    Maintenance tasks (deps, config, etc.)
//   perf:     Performance improvements
//   ci:       CI/CD changes
//   build:    Build system changes
//   revert:   Reverting a previous commit
//
// Example valid commits:
//   feat: add user registration form
//   fix: resolve login redirect loop
//   docs: update README with setup instructions
//
// See /docs/code-quality.md for more details.
// =============================================================================

module.exports = {
  extends: ['@commitlint/config-conventional'],
};
