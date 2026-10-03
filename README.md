# EDU — edu.vishnugandarapu.in

A self-hosted tutoring platform for small, batch-based courses: HTML lessons and class notes, live classes with chat, polls and engagement tools, Google Calendar invites, Razorpay checkout (UPI first), batch leagues and student profiles.

Not included by design: quizzes, assignments, video or recordings, video-meeting links, teaching assistants, seat limits and refund controls.

## Features

- **Courses:** modules, HTML lessons (pasted or loaded from an `.html` file and sanitised on save), attachments, free previews, progress tracking, batch-specific and date-released modules.
- **Class notes:** HTML notes with a contents list, search, PDF viewer, image lightbox, downloads and ZIP, scheduled publishing, optional reader-email stamp.
- **Live classes:** join by link or code, presenter view, attendance, chat moderation, polls, confusion and pace signals, fair student picker, exit tickets, session reports. Scheduled classes are added to the tutor's Google Calendar with the batch invited.
- **Enrolment:** free or paid offerings, one-time or manually renewed monthly access, coupons, receipts, renewal reminders.
- **Community:** batch-vs-batch league, customisable student profiles with privacy controls.
- **Admin:** subjects, batches, offerings, coupons, instructor invites, orders and revenue, terms and privacy pages, audit log.
- **Accounts:** data export and account deletion.

## Stack

| Path              | Purpose                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `apps/web`        | Next.js 15: pages, API, Better Auth (Google), Razorpay webhook     |
| `apps/realtime`   | Socket.IO service for live classes                                 |
| `apps/worker`     | pg-boss jobs: email, notes, calendar events, leagues, backups      |
| `packages/db`     | Drizzle schema, migrations, row-level security policies, SQL views |
| `packages/shared` | Permissions, validation schemas, shared rules                      |
| `packages/email`  | Email templates                                                    |
| `infra`           | Docker Compose (production and development), Caddy, backup scripts |
| `tests`           | Unit (Vitest), integration (PostgreSQL), browser (Playwright)      |

PostgreSQL 16, Redis 7 and S3-compatible storage (Cloudflare R2 in production). Side effects go through a transactional outbox, so a job is never lost or sent for a rolled-back change.

## Local development

Requirements: Node 22, pnpm (`corepack enable`), Docker with Compose.

```bash
cp .env.example .env   # set BETTER_AUTH_SECRET (openssl rand -hex 32) and Google credentials
pnpm install
docker compose -f infra/docker-compose.dev.yml up -d
pnpm db:migrate
pnpm dev               # web :3000, realtime :3001, worker
```

Development Compose runs PostgreSQL, Redis, SeaweedFS (S3-compatible, bucket created automatically) and Mailpit. The database starts empty; there is no sample data.

Sign in at `/tutor/login` with an address listed in `ADMIN_EMAILS` to become admin. Then add a subject and a batch under **Admin**, and create a course under **Teach**.

Every environment variable is documented in [`.env.example`](.env.example).

## Google setup

1. In Google Cloud Console, create an OAuth client (Web application) with redirect URI `<app-url>/api/auth/callback/google`.
2. On the consent screen, use scopes `openid`, `email`, `profile` and, for calendar invites, `https://www.googleapis.com/auth/calendar.events` (a sensitive scope: test users only until Google verifies the app).
3. Enable the **Google Calendar API**.
4. Tutors select **Connect Google Calendar** once under **Teach → course → Live classes**. Each scheduled class then gets a calendar event.

## Razorpay

Create test-mode keys, then add a webhook to `<app-url>/api/webhooks/razorpay` for `payment.captured`, `order.paid` and `refund.processed`. Enrolment happens when the webhook arrives. For local testing, expose the app with `cloudflared tunnel --url http://localhost:3000`. A refund made in the Razorpay dashboard removes that course access.

## Tests

```bash
pnpm lint && pnpm typecheck
pnpm test                # unit
pnpm test:integration    # creates and drops temporary databases
pnpm test:e2e            # browser; needs NODE_ENV=test, E2E_AUTH_BYPASS=1 and running services
```

Run browser tests against a separate, throwaway database: Playwright's setup adds the fixtures it needs. `PAYMENTS_STUB=1` replaces Razorpay order creation for local and CI runs and is refused in production.

## Branches and deployment

`main` is production. Each major feature is developed on a `feature/<name>` branch and merged by pull request once CI passes. CI runs lint, typecheck and all tests, then builds images; every push to `main` deploys to the VPS over SSH with a health check and automatic rollback.

To deploy manually on a VPS with Docker:

```bash
docker compose -f infra/docker-compose.yml --env-file .env build
docker compose -f infra/docker-compose.yml --env-file .env run --rm worker pnpm db:migrate
docker compose -f infra/docker-compose.yml --env-file .env up -d
```

Caddy issues TLS certificates for `APP_DOMAIN` and routes `/socket.io/*` to the realtime service.

## Backups

The worker uploads a nightly `pg_dump` to `BACKUP_R2_BUCKET` (30-day retention) and rehearses a restore every week into a temporary database. To restore manually, create an empty database and run `infra/backup/restore.sh <dump>` with `RESTORE_DATABASE_URL` set, then run migrations against it. Never restore over the live database.
