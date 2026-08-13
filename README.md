# Cumulist

**Local by default. Synced when you want.**

Cumulist is a polished, local-first task-management web app. It runs in any modern browser and ships as a production Docker image, making it portable across Linux, macOS, Windows, NAS devices, and cloud hosts.

## Current milestone

- Inbox, Today, Upcoming, and Completed views
- Fast task capture
- Projects, priorities, due dates, notes, completion, reopening, and deletion
- Search and responsive task-detail panel
- Browser-local persistence
- Responsive desktop and mobile interface
- Production Nginx container with health checks and SPA routing
- Hardened Docker Compose service running unprivileged and read-only

S3 backup and multi-device synchronization are **not implemented yet**. The interface labels S3 as *Not configured* rather than pretending it works.

## Run with Docker Compose

```bash
cp .env.example .env
docker compose up -d --build
```

Open:

```text
http://localhost:3080
```

On another device in the same LAN, replace `localhost` with the host's IP address.

Change the published port in `.env`:

```dotenv
CUMULIST_PORT=3080
```

## Verify and administer

```bash
docker compose config
docker compose ps
curl http://localhost:3080/healthz
docker compose logs --tail=100 web
```

Update or rebuild:

```bash
docker compose up -d --build
```

Stop the service:

```bash
docker compose down
```

## Frontend development

Prerequisite: Node.js 22 or newer.

```bash
npm ci
npm test
npm run dev
```

Production checks:

```bash
npm test
npm run lint
npm run build
```

## Data behavior in this milestone

Tasks are stored in the browser's local storage. This means:

- No PostgreSQL, MySQL, or separate database service is needed.
- Refreshing or restarting the container does not delete tasks from the same browser profile.
- Different browsers and machines currently have independent task lists.
- Clearing browser site data removes that browser's local tasks.

## Planned S3 architecture

S3 synchronization requires a backend component because browser JavaScript cannot—and should not—read host credentials from `~/.aws/credentials`.

The planned backend will:

1. Run as a separate Compose service.
2. Mount the host's AWS configuration read-only, for example `${HOME}/.aws:/home/cumulist/.aws:ro`.
3. Select a named profile through `AWS_PROFILE`.
4. Keep access keys out of source code, browser storage, and container images.
5. Add encrypted snapshots first, followed by operation-based multi-device synchronization.

Do not synchronize a raw SQLite file through S3. Multi-device sync will use stable UUIDs and an append-only operation log so edits from different machines can be merged safely.

## Security notes

The production web container:

- Runs as the unprivileged Nginx user.
- Uses a read-only root filesystem.
- Drops all Linux capabilities.
- Enables `no-new-privileges`.
- Exposes only internal port `8080` through the selected host port.
- Provides `/healthz` for orchestration checks.

Use HTTPS through a reverse proxy before exposing Cumulist outside a trusted LAN.
