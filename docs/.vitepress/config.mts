import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'VideoSphere Docs',
  description: 'Project documentation for VideoSphere.',
  base: '/',
  // TypeDoc HTML lives in docs/public/typedoc (gitignored; run `pnpm docs:api` first).
  ignoreDeadLinks: [/^\/typedoc(\/|$)/],
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Deploy', link: '/deployment-guide' },
      { text: 'Contributing', link: '/contributing' },
      { text: 'API', link: '/api/' },
    ],
    sidebar: [
      {
        text: 'Using VideoSphere',
        items: [{ text: 'Uploads, Livestreams & Distribution', link: '/uploads-and-distribution' }],
      },
      {
        text: 'Deploy & Operate',
        items: [
          { text: 'Deployment Guide', link: '/deployment-guide' },
          { text: 'R2 Storage', link: '/setup/r2/r2-module' },
          { text: 'Google OAuth', link: '/setup/google/google-oauth' },
          { text: 'Vimeo OAuth', link: '/setup/vimeo/vimeo-oauth' },
          { text: 'Facebook OAuth', link: '/setup/facebook/fb-oauth' },
          { text: 'SermonAudio API', link: '/setup/sermon-audio/sa-api' },
          { text: 'Password Recovery', link: '/password-recovery' },
          { text: 'Local Docker Testing', link: '/local-docker-testing' },
        ],
      },
      {
        text: 'Development',
        items: [
          { text: 'Contributing', link: '/contributing' },
          { text: 'Daily Dev Workflow', link: '/daily-dev-workflow' },
          { text: 'MongoDB Data Model', link: '/mongodb-data-model' },
          { text: 'Draft Document & Upload Testing', link: '/draft-document-and-upload-testing' },
          { text: 'Code Quality', link: '/code-quality' },
          { text: 'Testing', link: '/testing' },
          { text: 'Accessibility', link: '/accessibility' },
          { text: 'Performance', link: '/performance' },
          { text: 'TypeScript', link: '/typescript' },
        ],
      },
      {
        text: 'API',
        items: [
          { text: 'API Reference', link: '/api/' },
          { text: 'API Routes Guide', link: '/api-routes' },
          {
            text: 'Generated API Docs (TypeDoc)',
            link: '/typedoc/index.html',
            target: '_blank',
            rel: 'noopener noreferrer',
          },
        ],
      },
      {
        text: 'Contributor Tooling',
        items: [
          { text: 'Dev Container', link: '/devcontainer' },
          { text: 'Context7 MCP Setup', link: '/context7-setup' },
          { text: 'Figma MCP Setup', link: '/figma-mcp-setup' },
        ],
      },
    ],
  },
});
