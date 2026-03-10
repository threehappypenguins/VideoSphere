# Context7 MCP Setup

[Context7](https://context7.com/) is an MCP server that gives the AI up-to-date, version-specific documentation for many libraries (Next.js, Prisma, Supabase, React, etc.). It’s already configured in this project (`.vscode/mcp.json` and `.cursor/mcp.json`). Use **“use context7”** in prompts when you want current docs for a library.

---

## Rate limits and API key

The project config uses Context7 **without an API key**. That works but has **lower rate limits**. If you hit limits or want more usage:

1. **Get a free API key**: Sign in at [context7.com](https://context7.com/), go to the dashboard, and create an API key.
2. **Enable it in your user config** (do not put the key in the repo):
   - **VS Code**: Command Palette → **MCP: Open User Configuration**. Add or edit the `context7` server and set a header, e.g. `"CONTEXT7_API_KEY": "your-key"` in the `headers` object.
   - **Cursor**: Edit `~/.cursor/mcp.json` and add the header to the `context7` entry, e.g. `"headers": { "CONTEXT7_API_KEY": "your-key" }`.

After adding the key, reload the editor so the updated config is used. See [Context7 API keys](https://context7.com/docs/howto/api-keys) and [Plans & pricing](https://context7.com/docs/plans-pricing) for limits and options.
