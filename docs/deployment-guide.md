# Deployment Guide

## Deployment Options

| Platform   | Best For                    | Free Tier | Ease of Setup |
| ---------- | --------------------------- | --------- | ------------- |
| **Vercel** | Next.js (recommended)       | ✅ Yes    | ⭐⭐⭐⭐⭐    |
| Netlify    | Static/JAMstack sites       | ✅ Yes    | ⭐⭐⭐⭐      |
| Railway    | Full-stack with databases   | ✅ Yes    | ⭐⭐⭐        |
| Render     | Containers and web services | ✅ Yes    | ⭐⭐⭐        |

## Deploying to Vercel (Recommended)

Vercel is the company behind Next.js. Their platform is optimized for Next.js deployments with zero configuration.

### Step-by-Step

1. **Create a Vercel Account**
   - Go to [vercel.com](https://vercel.com)
   - Sign up with your GitHub account

2. **Import Your Repository**
   - Click "Add New Project"
   - Select your GitHub repository
   - Vercel will auto-detect that it's a Next.js project

3. **Configure Environment Variables**
   - In the project settings, add your environment variables
   - These are the same ones from your `.env.local` file
   - Never hardcode secrets in your code

4. **Deploy**
   - Click "Deploy"
   - Vercel will build and deploy your project
   - You'll get a live URL like `your-project.vercel.app`

5. **Automatic Deployments**
   - Every push to `main` triggers a new production deployment
   - Every PR gets a **preview deployment** with its own URL

### Preview Deployments

When you open a PR, Vercel automatically creates a preview deployment. This lets your team (and instructor) see the changes live before merging. The preview URL is posted as a comment on the PR.

## Environment Variables in Production

Your `.env.local` file is for local development only. In production, you configure environment variables through your hosting platform's dashboard:

- **Vercel**: Project Settings → Environment Variables
- **Netlify**: Site Settings → Build & Deploy → Environment Variables
- **Railway**: Project → Variables tab

**Important**: Never commit `.env.local` to git. It's already in `.gitignore`.

## Custom Domain

Most hosting platforms let you add a custom domain:

1. Purchase a domain from a registrar (Namecheap, Google Domains, etc.)
2. In your hosting platform, go to domain settings
3. Add your custom domain
4. Update your DNS records as instructed
5. Wait for DNS propagation (can take up to 48 hours)

## Useful Resources

- [Vercel Deployment Docs](https://vercel.com/docs)
- [Next.js Deployment Guide](https://nextjs.org/docs/app/building-your-application/deploying)
- [Netlify Docs](https://docs.netlify.com/)
- [Railway Docs](https://docs.railway.app/)
