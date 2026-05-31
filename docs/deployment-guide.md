# Deployment Guide

This guide prioritizes self-hosted Docker deployment. Managed platforms like Vercel can still be used when they fit your environment.

## Recommended: Self-Hosted With Docker

### Why Docker First

- Consistent runtime from local development to production
- Full control of infrastructure, secrets, and data
- Simple rollback and repeatable deployments

### Minimum Requirements

- Docker and Docker Compose
- MongoDB (containerized or external)
- Cloudflare R2 bucket for temporary media staging
- Platform credentials (YouTube, Vimeo, SermonAudio, Facebook)
- OpenRouter API key for AI metadata generation

### Step-by-Step

1. **Create production environment variables**
   - Copy your local `.env.local` values into a production `.env` file or secret manager.
   - Do not commit secrets.

2. **Configure compose file for your environment**
   - Set image/tag, ports, and restart policy.
   - Configure persistent volumes for MongoDB.

3. **Start the stack**

```bash
docker-compose up -d
```

4. **Verify health**
   - Check container status with `docker ps`.
   - Verify the app health endpoint and platform integrations.

5. **Operate and update**
   - Pull new image tags.
   - Restart with `docker-compose up -d`.
   - Keep database backups and rotate credentials.

## Optional: Managed Hosting Platforms

If self-hosting is not required, managed platforms can simplify operations.

### Vercel (Optional)

Vercel works well for Next.js application hosting. If you choose Vercel, run MongoDB separately and configure all required environment variables in the project settings.

### Other Options

| Platform   | Best For                    | Free Tier | Ease of Setup |
| ---------- | --------------------------- | --------- | ------------- |
| **Vercel** | Next.js app hosting         | ✅ Yes    | ⭐⭐⭐⭐⭐    |
| Netlify    | Static/JAMstack sites       | ✅ Yes    | ⭐⭐⭐⭐      |
| Railway    | Full-stack with databases   | ✅ Yes    | ⭐⭐⭐        |
| Render     | Containers and web services | ✅ Yes    | ⭐⭐⭐        |

## Deploying to Vercel

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
