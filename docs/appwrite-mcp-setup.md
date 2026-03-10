# Appwrite MCP Setup

This project uses [Appwrite's MCP servers](https://appwrite.io/docs/tooling/mcp) so that AI assistants (Copilot in VS Code, or Cursor) can use up-to-date Appwrite documentation when helping with code — helping avoid deprecated APIs and follow current best practices.

---

## VS Code + GitHub Copilot (team)

The **Appwrite Docs** MCP is already configured in the project at `.vscode/mcp.json`. Anyone opening the repo in VS Code with GitHub Copilot will have the Docs server available; no per-developer setup is required.

### What it does

- Gives Copilot access to current Appwrite docs (APIs, SDKs, best practices, code samples).
- Use cases: checking for deprecated usage (e.g. legacy Databases vs Tables), correct Auth/Databases/Storage examples, troubleshooting (401s, session/SSR), and recommended patterns.

### How to use it

1. Open the project in VS Code and ensure GitHub Copilot (and Copilot Chat) are enabled.
2. In Copilot Chat, **switch to Agent mode** so it can use MCP tools.
3. Ask Appwrite-related questions; Copilot will use the docs context when answering.

**Example prompts:**

- “How do we list users with the current Appwrite Node SDK?”
- “Is this Databases API usage deprecated? Should we use Tables?”
- “Show best practices for Appwrite Auth in a Next.js app with SSR.”
- “How do we set up real-time subscriptions for a collection?”

### If it doesn’t appear

- Run **MCP: Open User Configuration** from the Command Palette and confirm the project’s MCP config is being used, or that your user config doesn’t override the project.
- Restart VS Code after pulling changes to `.vscode/mcp.json`.

---

## Cursor (optional)

If you use Cursor instead of VS Code, the **Appwrite Docs** MCP is configured in `.cursor/mcp.json`. It loads when you open the project. Confirm in **Settings → Tools & MCP** that `appwrite-docs` is listed; you may need to restart Cursor once.

---

## Optional: Appwrite API MCP

The **API** MCP lets the AI run actions on your Appwrite project (list users, create documents, list collections, etc.). It’s optional and requires an API key, so it is **not** in the repo.

- **VS Code**: Command Palette → **MCP: Open User Configuration**, then add the `appwrite-api` server (see [Appwrite MCP for VS Code](https://appwrite.io/docs/tooling/mcp/vscode)).
- **Cursor**: Add it in your global config (`~/.cursor/mcp.json`) with `APPWRITE_API_KEY`, `APPWRITE_PROJECT_ID`, and `APPWRITE_ENDPOINT`. Keep the key out of the project.

---

## References

- [Appwrite MCP overview](https://appwrite.io/docs/tooling/mcp)
- [Appwrite MCP for VS Code](https://appwrite.io/docs/tooling/mcp/vscode)
- [Appwrite MCP for Cursor](https://appwrite.io/docs/tooling/mcp/cursor)
- [Appwrite MCP for Docs](https://appwrite.io/docs/tooling/mcp/docs)
- [Appwrite MCP for API](https://appwrite.io/docs/tooling/mcp/api)
