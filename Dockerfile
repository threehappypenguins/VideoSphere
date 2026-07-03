# =============================================================================
# VideoSphere — Docker image for the Next.js app
# =============================================================================
# Build: docker build -t videosphere .
# Verify amd64 + arm64 before push: docker buildx build --platform linux/amd64,linux/arm64 -f Dockerfile .
# Run:   docker run --name videosphere -p 9624:9624 --env-file .env.local videosphere
#
# Published platforms: linux/amd64, linux/arm64 (e.g. Odroid HC4).
# =============================================================================

ARG NODE_VERSION=24.16.0
FROM node:${NODE_VERSION}-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* .npmrc* ./
ENV HUSKY=0
RUN pnpm install --frozen-lockfile

FROM node:${NODE_VERSION}-alpine AS builder
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

FROM node:${NODE_VERSION}-alpine AS runner
ARG YT_DLP_VERSION=2026.3.17
ENV DENO_INSTALL=/usr/local
ENV PATH="/usr/local/bin:${PATH}"
ENV YT_DLP_REMOTE_COMPONENTS=none
RUN apk add --no-cache ffmpeg python3 py3-pip curl \
    && curl -fsSL https://deno.land/x/install/install.sh | sh \
    && pip3 install --break-system-packages "yt-dlp[default]==${YT_DLP_VERSION}" \
    && yt-dlp --version && deno --version && ffmpeg -version
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV XDG_CACHE_HOME=/app/.cache
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs \
    && mkdir -p /app/.cache \
    && chown -R nextjs:nodejs /app/.cache
# Warm yt-dlp YouTube extraction (deno + bundled yt-dlp-ejs from pip [default]).
RUN yt-dlp --no-update \
    --js-runtimes "deno:$(command -v deno)" \
    --js-runtimes "node:$(command -v node)" \
    -J --no-playlist "https://www.youtube.com/watch?v=jNQXAC9IVRw" \
    > /dev/null 2>&1 || true \
    && chown -R nextjs:nodejs /app/.cache
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
