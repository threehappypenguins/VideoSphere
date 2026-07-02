import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'VideoSphere Docs',
  description: 'Project documentation for VideoSphere.',
  base: '/',
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'API', link: '/api/' },
      { text: 'Development Workflow', link: '/daily-dev-workflow' },
      { text: 'Testing', link: '/testing' },
    ],
    sidebar: [
      {
        text: 'API',
        items: [
          { text: 'API Reference', link: '/api/' },
          {
            text: 'Generated API Docs (TypeDoc)',
            link: '/typedoc/index.html',
            target: '_blank',
            rel: 'noopener noreferrer',
          },
        ],
      },
      {
        text: 'Guides',
        items: [
          { text: 'Daily Dev Workflow', link: '/daily-dev-workflow' },
          { text: 'MongoDB Data Model', link: '/mongodb-data-model' },
          { text: 'Code Quality', link: '/code-quality' },
          { text: 'Testing', link: '/testing' },
          { text: 'Deployment Guide', link: '/deployment-guide' },
          { text: 'Local Docker Testing', link: '/local-docker-testing' },
        ],
      },
      {
        text: 'Credentials Setup',
        items: [{ text: 'R2 Storage', link: '/setup/r2/r2-module' }],
      },
    ],
  },
});
