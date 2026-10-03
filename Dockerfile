FROM node:26-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN corepack enable
FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/realtime/package.json apps/realtime/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/email/package.json packages/email/package.json
RUN pnpm install --frozen-lockfile
FROM dependencies AS build
COPY . .
ARG NEXT_PUBLIC_APP_URL=https://edu.vishnugandarapu.in
ARG NEXT_PUBLIC_REALTIME_URL=https://edu.vishnugandarapu.in
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_REALTIME_URL=$NEXT_PUBLIC_REALTIME_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN BETTER_AUTH_SECRET=build-only-placeholder-not-a-runtime-secret BETTER_AUTH_URL=$NEXT_PUBLIC_APP_URL pnpm --filter @edu/web build
FROM base AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node","apps/web/server.js"]
FROM dependencies AS service
COPY . .
ENV NODE_ENV=production
USER node
CMD ["pnpm","--filter","@edu/realtime","start"]
FROM service AS worker
USER root
# PostgreSQL 16 client for compatible pg_dump backups.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg && mkdir -p /usr/share/keyrings && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg && echo 'deb [signed-by=/usr/share/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main' > /etc/apt/sources.list.d/pgdg.list && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 && rm -rf /var/lib/apt/lists/*
USER node
CMD ["pnpm","--filter","@edu/worker","start"]
