# syntax=docker/dockerfile:1
# =============================================================================
# VideoSphere — Docker image for the Next.js app
# =============================================================================
# Build: docker build -t videosphere .
# Run:   docker run --name videosphere -p 9624:9624 --env-file .env.local videosphere
#
# Multi-arch homelab targets (Odroid HC4 = arm64, HC2 = arm/v7, etc.):
#   linux/amd64, linux/arm64  → Node 24 (official alpine images)
#   linux/arm/v6, linux/arm/v7 → Node 22 LTS (Node 24 dropped 32-bit ARM)
# =============================================================================

ARG NODE_VERSION=24.16.0
ARG NODE_VERSION_ARM32=22.22.0

FROM node:${NODE_VERSION}-alpine AS base-amd64
FROM node:${NODE_VERSION}-alpine AS base-arm64
FROM node:${NODE_VERSION_ARM32}-alpine AS base-arm

ARG TARGETARCH
FROM base-${TARGETARCH} AS base

# Stage 1: install dependencies
FROM base AS deps
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* .npmrc* ./
# arm/v6 and arm/v7 images use Node 22; relax engines only for those builds.
RUN echo "engine-strict=false" >> .npmrc \
    && pnpm install --frozen-lockfile

# Stage 2: build the app
FROM base AS builder
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* .npmrc* ./
COPY next.config.* tsconfig.json postcss.config.* ./
COPY public ./public
COPY app ./app
COPY components ./components
COPY hooks ./hooks
COPY lib ./lib
COPY types ./types
COPY proxy.ts instrumentation.ts ./

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# Stage 3: production runtime
FROM base AS runner
RUN apk add --no-cache ffmpeg
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --chown=nextjs:nodejs scripts ./scripts
COPY --chown=nextjs:nodejs lib/auth/password-policy.cjs ./lib/auth/password-policy.cjs
USER nextjs
EXPOSE 9624
ENV PORT=9624
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
