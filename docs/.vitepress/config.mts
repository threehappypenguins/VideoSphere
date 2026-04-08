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
          { text: 'Code Quality', link: '/code-quality' },
          { text: 'Testing', link: '/testing' },
          { text: 'Deployment Guide', link: '/deployment-guide' },
        ],
      },
    ],
    socialLinks: [
      {
        icon: 'github',
        link: 'https://github.com/NSCC-ITC-Winter2026-PROG5016-700-MCa/project-videosphere-team',
      },
    ],
  },
});
