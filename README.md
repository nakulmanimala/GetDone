# GetDone

**Local by default. Synced when you want.**

GetDone is a polished, local-first task-management web app. It runs in any modern browser and ships as a production Docker image, making it portable across Linux, macOS, Windows, NAS devices, and cloud hosts.

## Current milestone

- Inbox, Today, Upcoming, and Completed views
- Fast task capture
- Projects, priorities, due dates, notes, completion, reopening, and deletion
- Search and responsive task-detail panel
- Browser-local persistence
- Responsive desktop and mobile interface
- Production Nginx container with health checks and SPA routing
- Hardened Docker Compose service running unprivileged and read-only
- Encrypted S3 snapshot backup and restore, with conflict-aware sync (see [S3 backup and sync](#s3-backup-and-sync) below)

Full per-task, multi-device operation-log synchronization (merging simultaneous edits from several devices automatically) is **not implemented yet** — this milestone covers whole-list snapshot backup/restore only.

## Run with Docker Compose

```bash
cp .env.example .env
```

Fill in `.env` before starting the stack — at minimum `S3_BUCKET` and `SYNC_API_TOKEN` if you want S3 backup (see below); the app runs fine without them, with S3 Backup shown as *Not configured*.

```bash
docker compose up -d --build
```

Open:

```text
http://localhost:3080
```

On another device in the same LAN, replace `localhost` with the host's IP address.

Change the published port in `.env`:

```dotenv
GETDONE_PORT=3080
```

## Verify and administer

```bash
docker compose config
docker compose ps
curl http://localhost:3080/healthz
docker compose logs --tail=100 web
docker compose logs --tail=100 sync
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

## Sync backend development

The `sync` service (`backend/`) is a separate Node/TypeScript project with its own dependencies:

```bash
cd backend
npm ci
npm test
npm run build
```

## Data behavior in this milestone

Tasks are stored in the browser's local storage. This means:

- No PostgreSQL, MySQL, or separate database service is needed.
- Refreshing or restarting the container does not delete tasks from the same browser profile.
- Different browsers and machines currently have independent task lists.
- Clearing browser site data removes that browser's local tasks.

## S3 backup and sync

S3 synchronization runs through a separate `sync` Compose service (`backend/`) because browser JavaScript cannot—and should not—read host credentials from `~/.aws/credentials`. The `web` container talks to it over the internal Compose network via an `/api/` reverse-proxy in nginx; `sync` has no host port of its own.

### Setup

1. Create (or reuse) an S3 bucket and an IAM policy scoped to a single object, for example:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": ["s3:GetObject", "s3:PutObject", "s3:GetObjectVersion"],
       "Resource": "arn:aws:s3:::YOUR_BUCKET/getdone/snapshot.json.enc"
     }]
   }
   ```

   **Turn on bucket versioning.** GetDone stores one object; versioning is what lets you recover a previous snapshot if a sync conflict is resolved the wrong way (see below). This can't be enabled from the app — set it on the bucket itself.

2. Make sure `~/.aws/credentials` and `~/.aws/config` on the Docker host have a profile that can assume that policy.
3. Fill in `.env`: `AWS_PROFILE`, `AWS_REGION`, `S3_BUCKET`, and a `SYNC_API_TOKEN` (generate one with `openssl rand -hex 32`). `S3_SNAPSHOT_KEY` defaults to `getdone/snapshot.json.enc`.
4. `docker compose up -d --build`, then open the app, click **S3 Backup** in the sidebar, and set a passphrase and paste in the same `SYNC_API_TOKEN`.

`SYNC_API_TOKEN` is a *different, lower-stakes* secret from your AWS credentials — it only authenticates the browser to your own self-hosted `sync` container (there's no user-account system), and is stored in the browser's `localStorage`. AWS access keys never leave the `sync` container: they're read from the read-only `${HOME}/.aws:/home/getdone/.aws:ro` mount via the AWS SDK's default credential chain, selecting the profile named by `AWS_PROFILE`.

### Encryption

The passphrase you set in the S3 Backup panel never leaves the browser. It's run through PBKDF2 to derive an AES-GCM key (Web Crypto), which encrypts the task list before it's sent anywhere — the `sync` backend and S3 only ever handle ciphertext. **There is no passphrase recovery.** If you forget it, that backup can never be decrypted again; the app warns about this before you set one.

### How sync works

GetDone backs up the whole task list as a single encrypted JSON snapshot — not row-by-row. Direction is decided by comparing timestamps against a local "last synced" watermark, not just "whichever is newest":

- Only the remote changed since the last sync → **pull** (safe, no local work at risk).
- Only local changed since the last sync → **push**.
- **Both** changed since the last sync → flagged as a **conflict** in the UI ("keep local" / "keep S3") rather than silently overwritten, since a wrong guess here would destroy real edits with no merge to fall back on.

This is why bucket versioning matters: whichever side you don't keep in a conflict is still recoverable from S3's version history.

### Auto backup

Once you unlock S3 Backup with your passphrase for the current browser session, syncing happens automatically — no need to click **Back Up Now** after every change:

- A few seconds after any local edit, the app runs the same watermark check above and pushes, pulls, or flags a conflict as needed.
- Every 5 minutes it also checks in the background, so changes pushed from another device get pulled in even if you haven't touched this one.
- The passphrase itself is **never persisted** — it only lives in memory for that browser tab's session. Auto backup runs only after you've unlocked; it won't sync anything before that, and closing the tab (or reloading) requires unlocking again. This is a deliberate tradeoff for the no-recovery encryption model above.
- A conflict still pauses auto-sync and waits for you to resolve it in the S3 Backup panel — it's never auto-resolved.

## Security notes

Both the `web` and `sync` containers:

- Run as an unprivileged user (Nginx's built-in user for `web`; a dedicated `getdone` user for `sync`).
- Use a read-only root filesystem.
- Drop all Linux capabilities.
- Enable `no-new-privileges`.
- Provide `/healthz` for orchestration checks.

`web` exposes its internal port `8080` through the selected host port; `sync` has **no host port at all** — it's reachable only from `web` over the internal Compose network, and AWS credentials never leave it. `sync`'s `~/.aws` mount is read-only, and it refuses to start if `S3_BUCKET` or `SYNC_API_TOKEN` is missing.

Use HTTPS through a reverse proxy before exposing GetDone outside a trusted LAN.
