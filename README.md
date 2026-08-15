# GetDone

**A private task list for each person on your team.**

GetDone is a polished task-management web app for a single Google Workspace team. It runs in any modern browser and ships as a production Docker image, making it portable across Linux, macOS, Windows, NAS devices, and cloud hosts.

## Current milestone

- Google sign-in restricted to one Workspace domain, with a private task list per person (see [Team accounts with Google sign-in](#team-accounts-with-google-sign-in))
- Inbox, Today, Upcoming, and Completed views
- Fast task capture
- Lists, due dates with an optional time, repeats, notes, completion, reopening, and deletion
- Paste an image from the clipboard onto a task to attach it (compressed automatically before storage)
- Inline task capture and editing, in the style of Google Tasks
- Search, and browser-local persistence scoped per account
- Responsive desktop and mobile interface
- Production Nginx container with health checks and SPA routing
- Hardened Docker Compose service running unprivileged and read-only
- Encrypted S3 snapshot backup and restore, with conflict-aware sync (see [S3 backup and sync](#s3-backup-and-sync) below)

Full per-task, multi-device operation-log synchronization (merging simultaneous edits from several devices automatically) is **not implemented yet** — this milestone covers whole-list snapshot backup/restore only.

## Run with Docker Compose

```bash
cp .env.example .env
```

Fill in `.env` before starting the stack. Sign-in is required, so `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `APP_ORIGIN`, `S3_BUCKET`, and `SYNC_ENCRYPTION_KEY` must all be set — the `sync` container refuses to start otherwise. See [Team accounts with Google sign-in](#team-accounts-with-google-sign-in).

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

## Team accounts with Google sign-in

Everyone signs in with their own `@entri.me` Google account and gets a task list only they can see. There is still no database: the user registry is a single JSON object in S3, and each person's tasks are their own encrypted object.

### How access is decided

- **Domain restriction.** Only accounts in the Workspace domain named by `GOOGLE_ALLOWED_DOMAIN` may sign in. This is enforced on the server against the `hd` claim in Google's signed ID token *and* the verified email address — not by the `hd` parameter in the sign-in URL, which is only a hint to the account chooser and can be edited by anyone.
- **First user is the owner.** Whoever signs in first is recorded with the `superuser` role and can list the team at `GET /api/admin/users`. Everyone after them is a `member`. The registry is written with an S3 conditional write, so two simultaneous first sign-ins cannot both claim ownership.
- **Sessions.** A signed, `httpOnly`, `SameSite=Lax` cookie, valid for 30 days by default (`SESSION_TTL_SECONDS`). Page JavaScript cannot read it, so an XSS bug cannot exfiltrate a session.

### Setup

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an **OAuth 2.0 Client ID** of type *Web application*:
   - **Authorised JavaScript origin**: your `APP_ORIGIN`, e.g. `https://tasks.entri.me`
   - **Authorised redirect URI**: that origin plus `/api/auth/callback`, e.g. `https://tasks.entri.me/api/auth/callback`
2. Put the client ID and secret in `.env`, along with `APP_ORIGIN` and a `SESSION_SECRET` (`openssl rand -hex 32`).
3. `docker compose up -d --build`, open the app, and sign in. You are now the owner.

`APP_ORIGIN` must be `https` unless it is `localhost` — Google rejects plain-http redirect URIs, and the session cookie is only marked `Secure` when the origin is https. The container checks this at boot and refuses to start on a misconfiguration rather than running insecurely.

### What each person can and cannot see

Task data never passes through a shared object. The S3 key is derived from the signed-in user's Google subject id on the server (`getdone/users/<sub>/snapshot.json.enc`) and is never taken from the request, so there is no parameter a user could bend toward a teammate's backup. Locally, each account's tasks are stored under their own `localStorage` key, so two people sharing a browser profile do not see each other's lists.

The `superuser` role currently grants exactly one extra ability: listing who is in the workspace. It does **not** grant access to other people's tasks.

## Data behavior in this milestone

Tasks are stored in the browser's local storage, scoped to the signed-in account, and backed up to S3 per user. This means:

- No PostgreSQL, MySQL, or separate database service is needed.
- Refreshing or restarting the container does not delete tasks from the same browser profile.
- A browser that has never synced has independent tasks; sign in and restore to pull your list onto a new machine.
- Clearing browser site data removes that browser's local tasks (the S3 backup survives).

## S3 backup and sync

S3 synchronization runs through a separate `sync` Compose service (`backend/`) because browser JavaScript cannot—and should not—read host credentials from `~/.aws/credentials`. The `web` container talks to it over the internal Compose network via an `/api/` reverse-proxy in nginx; `sync` has no host port of its own.

### Setup

1. Create (or reuse) an S3 bucket and an IAM policy covering the per-user prefix and the user registry, for example:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": ["s3:GetObject", "s3:PutObject", "s3:GetObjectVersion"],
       "Resource": [
         "arn:aws:s3:::YOUR_BUCKET/getdone/users/*",
         "arn:aws:s3:::YOUR_BUCKET/getdone/users.json"
       ]
     }]
   }
   ```

   > **Upgrading from the single-user version:** the old policy was scoped to the exact object `getdone/snapshot.json.enc`. It must be widened to the prefix above, or every backup will fail with an access error.

   **Turn on bucket versioning.** Versioning is what lets you recover a previous snapshot if a sync conflict is resolved the wrong way (see below). This can't be enabled from the app — set it on the bucket itself.

2. Make sure `~/.aws/credentials` and `~/.aws/config` on the Docker host have a profile that can assume that policy.
3. Fill in `.env`: `AWS_PROFILE`, `AWS_REGION`, `S3_BUCKET`, and a `SYNC_ENCRYPTION_KEY` (generate one with `openssl rand -base64 32`). `S3_SNAPSHOT_PREFIX` defaults to `getdone/users` and `S3_USERS_KEY` to `getdone/users.json`.
4. `docker compose up -d --build`, then sign in. Backup is on from that moment — there is nothing to configure per browser.

AWS access keys never leave the `sync` container: they're read from the read-only `${HOME}/.aws:/home/getdone/.aws:ro` mount via the AWS SDK's default credential chain, selecting the profile named by `AWS_PROFILE`.

### Encryption

Snapshots are encrypted at rest with AES-256-GCM, but the key lives entirely on the `sync` backend (from `SYNC_ENCRYPTION_KEY`), not derived from anything you type — there's no passphrase, no "unlock" step, and nothing to forget. The browser sends the task list to `sync` over the session-authenticated `/api/snapshot` route as plain JSON; `sync` encrypts it before writing to that user's own object and decrypts it on read. One key protects every user's snapshot; isolation between teammates comes from the session-derived object key and IAM, not from separate keys. This trades away the stronger guarantee of the old client-side-passphrase design (there, not even a compromised backend could read your tasks) for zero friction — anyone with access to the `sync` container or its `SYNC_ENCRYPTION_KEY` can decrypt your backups, same trust boundary as the AWS credentials already sitting there.

> **Upgrading from an older version**: snapshots pushed under the previous passphrase-based scheme use a different key and envelope format and can't be decrypted by this backend. They're not lost — your tasks are still local — but that S3 object is orphaned. Open S3 Backup and click **Back Up Now** to replace it with a fresh snapshot in the new format.

### How sync works

GetDone backs up the whole task list as a single encrypted JSON snapshot — not row-by-row. Direction is decided by comparing timestamps against a local "last synced" watermark, not just "whichever is newest":

- Only the remote changed since the last sync → **pull** (safe, no local work at risk).
- Only local changed since the last sync → **push**.
- **Both** changed since the last sync → flagged as a **conflict** in the UI ("keep local" / "keep S3") rather than silently overwritten, since a wrong guess here would destroy real edits with no merge to fall back on.

This is why bucket versioning matters: whichever side you don't keep in a conflict is still recoverable from S3's version history.

### Auto backup

As soon as you are signed in, syncing happens automatically — nothing to configure, no unlock step, no need to click **Back Up Now** after every change:

- A few seconds after any local edit, the app runs the same watermark check above and pushes, pulls, or flags a conflict as needed.
- Every 5 minutes it also checks in the background, so changes pushed from another device get pulled in even if you haven't touched this one.
- A conflict still pauses auto-sync and waits for you to resolve it in the S3 Backup panel — it's never auto-resolved.

## Security notes

Both the `web` and `sync` containers:

- Run as an unprivileged user (Nginx's built-in user for `web`; a dedicated `getdone` user for `sync`).
- Use a read-only root filesystem.
- Drop all Linux capabilities.
- Enable `no-new-privileges`.
- Provide `/healthz` for orchestration checks.

`web` exposes its internal port `8080` through the selected host port; `sync` has **no host port at all** — it's reachable only from `web` over the internal Compose network, and AWS credentials never leave it. `sync`'s `~/.aws` mount is read-only, and it refuses to start if any of `S3_BUCKET`, `SYNC_ENCRYPTION_KEY`, `SESSION_SECRET`, `APP_ORIGIN`, `GOOGLE_CLIENT_ID`, or `GOOGLE_CLIENT_SECRET` is missing or malformed.

The Google client secret and the session-signing secret live only in the `sync` container; the browser never receives either. Session cookies are `HttpOnly` and `SameSite=Lax`, and `Secure` whenever `APP_ORIGIN` is https.

Use HTTPS through a reverse proxy before exposing GetDone outside a trusted LAN.
