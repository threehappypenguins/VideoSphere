# Figma MCP Server Integration Guide

This guide provides step-by-step instructions for setting up and using the Figma Model Context Protocol (MCP) server in VS Code for VideoSphere. The Figma MCP server enables Copilot to access your Figma design files, understand design tokens, and generate components that match your design system.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Individual Setup Steps](#individual-setup-steps)
4. [Verifying the Setup](#verifying-the-setup)
5. [Using Figma MCP with Copilot](#using-figma-mcp-with-copilot)
6. [Troubleshooting](#troubleshooting)

---

## Overview

The Figma MCP server is an HTTP-based Model Context Protocol server that allows AI models like Copilot to:

- **Access design files** from Figma workspaces
- **Extract design tokens** (colors, typography, spacing, etc.)
- **Understand component libraries** and design systems
- **Generate code** that respects design specifications
- **Reference design systems** in prompts for accurate component generation

### Current Configuration

VideoSphere already has the Figma MCP server configured in `.vscode/mcp.json`:

```json
{
  "inputs": [],
  "servers": {
    "figma": {
      "url": "https://mcp.figma.com/mcp",
      "type": "http"
    }
  }
}
```

This configuration is **already in place**. However, each developer must complete authentication steps to enable Copilot to access their Figma projects.

---

## Prerequisites

Before setting up the Figma MCP server, ensure you have:

- **A Figma account** (free or paid)
- **Access to the VideoSphere Figma project** (shared by Christian)
- **VS Code with GitHub Copilot** installed and activated
- **The latest version of VS Code** (1.96+)
- **Node.js and npm** installed locally

---

## Individual Setup Steps

### Step 1: Generate a Figma API Token

Each developer must create a personal Figma API token to authenticate with the MCP server:

1. **Open Figma** in your browser and log in to your account
2. **Navigate to Account Settings**:
   - Click your profile avatar (top-left or bottom-left of the screen)
   - Select **Settings**
3. **Go to Personal Access Tokens section**:
   - In the Security tab, find and click **Personal access tokens**
4. **Create a new token**:
   - Click **Generate new token**
   - Give it a descriptive name, e.g., `VS Code Copilot - [Your Name]`
   - Set an appropriate expiration date (recommended: 90 days)
5. **Copy the token**:
   - The token will be displayed once. Copy it immediately and store it securely
   - **⚠️ Do not commit this token to version control**
   - **⚠️ Do not share this token with other developers**

### Step 2: Add the Token to Your Environment

The Figma MCP server authenticates via the `FIGMA_API_TOKEN` environment variable.

#### Option A: Using `.env.local` (Recommended for Development)

1. **Create or edit `.env.local`** in the workspace root:
   ```bash
   echo "FIGMA_API_TOKEN=your_token_here" >> .env.local
   ```

2. **Replace `your_token_here`** with the token you generated in Step 1

3. **Verify the file is in `.gitignore`**:
   - Check that `.env.local` is listed in `.gitignore` (it should be by default in Next.js projects)
   - Confirm with: `grep "\.env\.local" .gitignore`

#### Option B: Using System Environment Variables

If you prefer system-wide configuration:

**On macOS/Linux:**
```bash
export FIGMA_API_TOKEN="your_token_here"
```

Add this to your shell profile (`~/.zshrc`, `~/.bashrc`, etc.) to persist across sessions.

**On Windows (PowerShell):**
```powershell
[Environment]::SetEnvironmentVariable("FIGMA_API_TOKEN", "your_token_here", "User")
```
Then restart VS Code for the change to take effect.

### Step 3: Restart VS Code and Verify Authentication

1. **Close and reopen VS Code** to ensure environment variables are loaded
2. **Open the Command Palette**: `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS)
3. **Run**: `Developer: Show Logs` → select `Copilot` to check for connection errors
4. **In a chat session**, ask Copilot: "What Figma projects can you access?"
   - If authenticated successfully, Copilot should list available projects

---

## Verifying the Setup

### Method 1: Check MCP Server Status in VS Code

1. Open the **Copilot Chat** panel
2. In your message, type a test prompt: `Can you tell me what Figma files you have access to?`
3. If the MCP server is connected, Copilot will retrieve and display available Figma files

### Method 2: Review Debug Logs

1. Open **Command Palette**: `Ctrl+Shift+P` / `Cmd+Shift+P`
2. Run **Developer: Show Logs** and select **Copilot**
3. Look for messages indicating successful MCP server connection:
   ```
   [INFO] MCP Server 'figma' connected successfully
   ```

### Method 3: Verify Token Permissions

Your token should have the following permissions:
- ✅ **Read files** (required to access design files)
- ✅ **Read team files** (if accessing team projects)

If the token was created correctly, these are granted by default.

---

## Using Figma MCP with Copilot

### Basic Workflow

1. **Reference your Figma file** in the chat prompt
2. **Ask Copilot to generate components** based on design specifications
3. **Copilot will fetch design tokens and component definitions** from Figma
4. **Code is generated** to match your design system

### Example Prompts

#### Example 1: Generate a Component from Design

```
In Figma, I have a design file at https://www.figma.com/design/[FILE_ID]/VideoSphere-Components

Please generate a TypeScript React component for the "Upload Button" component shown in that file.
Use the design tokens (colors, spacing, typography) from the design system.
Include all interactive states (hover, active, disabled).
```

#### Example 2: Extract Design Tokens

```
I'm looking at the VideoSphere design system in Figma: https://www.figma.com/design/[FILE_ID]/Design-System

Can you extract the color palette, typography scale, and spacing system?
Provide the extracted tokens as a TypeScript object.
```

#### Example 3: Implement Multiple Components

```
Reference the Figma file: https://www.figma.com/design/[FILE_ID]/UI-Library

Generate React components for:
- Header navigation component
- Card component
- Form input component

Ensure all components follow the design tokens and match the visual specifications in Figma.
```

### Tips for Better Results

1. **Include Figma file links** in your prompts for Copilot to fetch the correct designs
   - Format: `https://www.figma.com/design/[FILE_ID]/[FILE_NAME]`

2. **Mention specific design tokens** you want respected:
   - "Use the color tokens from the design system"
   - "Follow the 8px spacing scale"
   - "Use the typography scale defined in Figma"

3. **Reference component names** as they appear in Figma:
   - "Generate the 'Button' component as shown in Figma"
   - "Create the 'Modal' component from the Library section"

4. **Ask for design-specific features**:
   - "Include all states from the Figma prototype (hover, focus, disabled)"
   - "Match the animation timing shown in the Figma micro-interactions"
   - "Apply the responsive breakpoints from the design system"

### Integration with shadcn/ui

VideoSphere uses **shadcn/ui** for component libraries. When generating components:

```
Reference the Figma design system and generate a shadcn/ui-compatible component for [Component Name].
Ensure Tailwind CSS classes match our design tokens and the component is accessible (WCAG 2.1 AA).
```

---

## Advanced Configuration

### Setting a Custom MCP Server URL

If Figma provides an alternative MCP server endpoint, update `.vscode/mcp.json`:

```json
{
  "inputs": [],
  "servers": {
    "figma": {
      "url": "https://custom-mcp-endpoint.example.com/figma",
      "type": "http"
    }
  }
}
```

### Configuring Timeout and Retry Policies

For unreliable network connections, you can configure timeout behavior (if supported by your VS Code version):

```json
{
  "inputs": [],
  "servers": {
    "figma": {
      "url": "https://mcp.figma.com/mcp",
      "type": "http",
      "timeout": 30000,
      "retries": 3
    }
  }
}
```

### Advanced Token Configuration Notes

The Figma MCP server reads your API token **only** from the `FIGMA_API_TOKEN` environment variable. VS Code settings such as `"figma.token"` are **not** consumed by this MCP server and will not configure authentication for it.

**Recommended (advanced) approach for workspace-specific config:** use a shell script, `.env` file loader, or your terminal profile to export `FIGMA_API_TOKEN` before starting VS Code.

Example (bash/zsh):
```bash
export FIGMA_API_TOKEN="your_api_token_here"
code .
```

### Using the HTML-to-Design Capture Tool (Optional)

The Figma **capture** script (`https://mcp.figma.com/mcp/html-to-design/capture.js`) is a developer tool for capturing the current page’s HTML/design and sending it to Figma. It is **not** required for MCP (which works via Cursor and `FIGMA_API_TOKEN`). Use it only when you need to capture a page; do not inject it into the app’s root layout.

**Option 1 — Browser console (one-off use)**  
Open the page you want to capture, open DevTools → Console, then run:

```javascript
const s = document.createElement('script');
s.src = 'https://mcp.figma.com/mcp/html-to-design/capture.js';
s.async = true;
document.head.appendChild(s);
```

**Option 2 — Bookmarklet**  
Create a bookmark with this as the URL (one line, no line break):

```text
javascript:(function(){var s=document.createElement('script');s.src='https://mcp.figma.com/mcp/html-to-design/capture.js';s.async=true;document.head.appendChild(s);})();
```

Click the bookmark when you’re on the page you want to capture. The tool will load only for that tab/session.

---

## Troubleshooting

### Issue: "MCP Server Connection Failed"

**Cause**: The Figma MCP server URL is unreachable or misconfigured.

**Solution**:
1. Verify your internet connection
2. Check that `mcp.json` contains the correct URL: `https://mcp.figma.com/mcp`
3. Check for any firewall or proxy blocking the connection
4. In VS Code, run **Developer: Show Logs** → **Copilot** to see detailed error messages

### Issue: "Authentication Failed" or "API Token Rejected"

**Cause**: Missing or invalid `FIGMA_API_TOKEN` environment variable.

**Solution**:
1. Verify your token is set:
   ```bash
   echo $FIGMA_API_TOKEN  # macOS/Linux
   echo %FIGMA_API_TOKEN%  # Windows
   ```
   Should output your token (not blank)

2. If blank, re-add the token to `.env.local`:
   ```bash
   FIGMA_API_TOKEN=your_valid_token
   ```

3. **Restart VS Code** completely:
   - Close all windows
   - Reopen the workspace
   - Environment variables are loaded on startup

4. Verify the token is still valid in Figma:
   - Go to **Figma Settings** → **Personal access tokens**
   - Check that your token hasn't expired
   - If expired, regenerate a new token

5. Ensure your Figma account has access to the VideoSphere project

### Issue: "No Figma Files Found"

**Cause**: Token doesn't have permission to access the files, or files aren't shared with your account.

**Solution**:
1. Verify you have access to the VideoSphere Figma project:
   - Open Figma in your browser
   - Check that you can see the project in your **Recent files** or **Team projects**

2. Ask the design team to share the Figma file:
   - Request access via the Figma collaboration settings
   - Ensure the file is shared with your Figma account

3. Check token permissions:
   - In Figma Settings, verify your personal access token has read permissions
   - Token should allow reading files and team projects

4. Include the full Figma URL in your Copilot prompt:
   ```
   https://www.figma.com/design/FILE_ID/Project-Name
   ```

### Issue: "Timeout: Figma MCP Server Took Too Long"

**Cause**: Large Figma files or slow network connection.

**Solution**:
1. Try requesting a specific component instead of the entire file
2. Break large requests into smaller prompts
3. Check your network speed and connectivity
4. If using a proxy or VPN, try connecting without it

### Issue: "Token Leaked or Exposed"

**If you accidentally commit your token to Git**:

1. **Immediately revoke the token**:
   - Go to Figma Settings → Personal access tokens
   - Delete the exposed token

2. **Generate a new token**:
   - Follow [Step 1](#step-1-generate-a-figma-api-token) again

3. **Update your local environment**:
   - Update `.env.local` with the new token

4. **Clean up Git history** (if in a shared repository):
   - Use **git filter-repo** (recommended) or see [GitHub's guide to removing sensitive data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository). All collaborators must re-clone or rebase onto the new history.
   ```bash
   # Install git-filter-repo if you don't have it:
   # https://github.com/newren/git-filter-repo
   # Remove .env.local from the entire history (all branches and tags)
   git filter-repo --path .env.local --invert-paths
   # Force-push rewritten history
   git push --force --all
   git push --force --tags
   ```

---

## Best Practices

### Security

- ✅ **Store tokens in environment variables** or `.env.local`
- ✅ **Never commit tokens** to version control
- ✅ **Rotate tokens periodically** (every 6-12 months)
- ✅ **Use separate tokens per environment** (local dev, CI/CD, staging)
- ✅ **Revoke tokens immediately** if exposed

### Performance

- ✅ **Reference specific Figma files** in prompts for faster responses
- ✅ **Ask for specific components** rather than entire design systems
- ✅ **Break large requests** into smaller prompts for better results
- ✅ **Cache often-used design tokens** in your code

### Workflow

- ✅ **Keep design and code in sync** using Figma MCP as the source of truth
- ✅ **Include design tokens** in your component generation prompts
- ✅ **Reference Figma designs** when reviewing code changes
- ✅ **Document design decisions** using Figma's annotation features

---

## Resources

- [Figma MCP Server Official Documentation](https://mcp.figma.com)
- [Figma REST API Documentation](https://www.figma.com/developers/api)
- [Figma Developer Community](https://discord.gg/xzQhe2Vcvx)
- [VideoSphere Design System](https://www.figma.com/design/[FILE_ID]/VideoSphere) (internal)
- [Next.js Environment Variables](https://nextjs.org/docs/basic-features/environment-variables)
- [GitHub Copilot Chat Documentation](https://code.visualstudio.com/docs/copilot/copilot-chat)

---

## FAQ

**Q: Do I need a paid Figma account?**
A: No, the Figma MCP server works with both free and paid accounts. You need read access to the design files.

**Q: Can I use the same token on multiple machines?**
A: Yes, the token is specific to your Figma account and can be used on any machine where you set the environment variable.

**Q: What happens if my token expires?**
A: You'll need to generate a new token in Figma and update it in your environment variables.

**Q: Can I access team projects with an individual token?**
A: Yes, if your Figma account has been invited to the team and has appropriate permissions.

**Q: Is it safe to share my Figma project link in prompts?**
A: Yes, sharing the Figma design file URL is safe. **Never share your API token.**

**Q: How do I update my token without restarting VS Code?**
A: Reload the VS Code window using **Command Palette** → **Developer: Reload Window**.

---

## Support

If you encounter issues not covered in this guide:

1. Check VS Code logs: **Developer: Show Logs** → **Copilot**
2. Review the [troubleshooting section](#troubleshooting)
3. Contact the development team or DevOps
4. Reference [Figma MCP Server issues](https://github.com/figma/mcp-server-figma/issues) on GitHub
