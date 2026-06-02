# =============================================================================
# VideoSphere — Docker image for the Next.js app
# =============================================================================
# Build: docker build -t videosphere .
# Run:   docker run --name videosphere -p 3000:3000 --env-file .env.local videosphere
# =============================================================================

# Stage 1: install dependencies
ARG NODE_VERSION=20.19.0
FROM node:${NODE_VERSION}-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* .npmrc* ./
RUN pnpm install --frozen-lockfile

# Stage 2: build the app
FROM node:${NODE_VERSION}-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
# Copy only what's needed to build; .dockerignore excludes .env.local, etc.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* .npmrc* ./
COPY next.config.* tsconfig.json postcss.config.* ./
COPY public ./public
COPY app ./app
COPY components ./components
COPY lib ./lib
COPY types ./types
# Build-time env (only NEXT_PUBLIC_* and vars needed at build)
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# Stage 3: production runtime
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --chown=nextjs:nodejs scripts ./scripts
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./script_node_modules
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
