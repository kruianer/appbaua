# Multi-stage build for the Next.js app (standalone output).
# Produces a small runtime image that runs `node server.js`.

# ---- deps: install production+build deps ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: compile the standalone bundle ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next telemetry off in CI-like builds.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner: minimal runtime ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# git at runtime: "Auf appbaua umstellen" (req-012) clones the appbaua source and
# the target repo from inside the app and pushes to the target's dev branch — or
# to its default branch when it has no dev (req-013).
#
# The Claude Code CLI: the chat (req-040) runs in this container and calls the
# same runClaude as the worker. Without it every message answered "Claude-Code-
# CLI nicht verfügbar" (bug-028).
RUN apk add --no-cache git \
  && npm install -g @anthropic-ai/claude-code

# Where that rollout clones repos (must be writable by the app user).
ENV WORKER_WORKDIR=/work

# The chat's own working copy (req-040 AC15), on its own volume so a deploy
# does not wipe it out from under a running Claude session (bug-029).
ENV CHAT_WORKDIR=/chat-work

# Claude Code auth lives here too (claude-home volume, mounted read-only — see
# docker-compose.yml). Without this HOME points at /home/nextjs and the CLI
# never finds the subscription login (bug-028).
ENV HOME=/claude-home

# Run as non-root.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone server + static assets. schema.sql is traced in via
# outputFileTracingIncludes and lands under lib/ in the standalone tree.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Directory for the JSON fallback store (used only when DATABASE_URL is unset),
# the work dir for the appbaua rollout (req-012), and the chat's own working
# copy (bug-029).
#
# /claude-home/.claude/projects also gets created here: docker-compose.yml
# mounts a SEPARATE writable volume over exactly this subpath of the
# read-only claude-home volume (bug-032). Claude Code keeps its sessions
# there, named after the cwd — with claude-home entirely read-only (bug-028),
# the chat could never write one, so EVERY turn, not just one after a
# restart, found no session to resume. A named volume adopts the ownership
# this directory already has in the image on first mount, so without the
# chown below it would come up owned by root and stay unwritable for nextjs.
RUN mkdir -p .data /work /chat-work /claude-home/.claude/projects \
  && chown -R nextjs:nodejs .data /work /chat-work /claude-home

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
