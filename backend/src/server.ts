import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { S3Client } from '@aws-sdk/client-s3'
import { loadConfig, snapshotKeyFor, type Config } from './config.js'
import { createS3Client } from './s3Client.js'
import { createS3SnapshotStore, type SnapshotStore } from './snapshotStore.js'
import { createS3UserStore, type UserStore } from './userStore.js'
import { PayloadTooLargeError, readJsonBody, sendJson, sendText } from './httpUtils.js'
import { validatePayload } from './validate.js'
import { decryptPayload, encryptPayload, type EncryptedEnvelope } from './snapshotCrypto.js'
import {
  buildAuthorizationUrl,
  createJwksCache,
  DomainNotAllowedError,
  exchangeCodeForIdToken,
  statesMatch,
  verifyIdToken,
  type Fetcher,
  type GoogleOAuthConfig,
} from './googleAuth.js'
import {
  clearPendingOAuthCookie,
  clearSessionCookie,
  createPendingOAuthCookie,
  createSessionCookie,
  readPendingOAuth,
  readSession,
  safeReturnPath,
  type Session,
} from './session.js'

// Keep in sync with docker/nginx.conf's client_max_body_size for /api/.
const MAX_BODY_BYTES = 10 * 1024 * 1024

export interface AppDeps {
  config: Config
  userStore: UserStore
  /** Bound per request to the signed-in user's own object. */
  openSnapshotStore: (key: string) => SnapshotStore
  fetchFn?: Fetcher
  now?: () => number
}

function redirect(res: ServerResponse, location: string, cookies: string[] = []): void {
  res.writeHead(302, { Location: location, ...(cookies.length ? { 'Set-Cookie': cookies } : {}) })
  res.end()
}

export function createApp({ config, userStore, openSnapshotStore, fetchFn = fetch, now = Date.now }: AppDeps) {
  const oauth: GoogleOAuthConfig = {
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
    redirectUri: `${config.appOrigin}/api/auth/callback`,
    allowedDomain: config.allowedDomain,
  }
  const getJwks = createJwksCache(fetchFn, now)
  // Google only accepts https redirect URIs off localhost, so the origin's
  // scheme is exactly the right signal for whether to mark cookies Secure.
  const secureCookies = config.appOrigin.startsWith('https://')

  /** Sends the browser back to the app with a message the sign-in page shows. */
  function failSignIn(res: ServerResponse, reason: string): void {
    redirect(res, `/?authError=${encodeURIComponent(reason)}`, [clearPendingOAuthCookie(secureCookies)])
  }

  async function handleLogin(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const start = buildAuthorizationUrl(oauth, url.searchParams.get('prompt') ?? undefined)
    const pending = {
      state: start.state,
      codeVerifier: start.codeVerifier,
      returnTo: safeReturnPath(url.searchParams.get('returnTo')),
    }
    redirect(res, start.url, [createPendingOAuthCookie(pending, config.sessionSecret, secureCookies, now)])
  }

  async function handleCallback(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    // Google reports user-facing refusals (closed window, denied consent) here.
    const oauthError = url.searchParams.get('error')
    if (oauthError) {
      failSignIn(res, oauthError === 'access_denied' ? 'Sign-in was cancelled.' : 'Google rejected the sign-in.')
      return
    }

    const pending = readPendingOAuth(req.headers.cookie, config.sessionSecret, now)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')

    if (!pending || !code || !state || !statesMatch(pending.state, state)) {
      // Either the attempt expired or the state does not match what we issued.
      failSignIn(res, 'Sign-in expired or was tampered with. Please try again.')
      return
    }

    let identity
    try {
      const idToken = await exchangeCodeForIdToken(oauth, code, pending.codeVerifier, fetchFn)
      try {
        identity = verifyIdToken(idToken, await getJwks(), oauth, now)
      } catch (error) {
        if (error instanceof DomainNotAllowedError) throw error
        // A rotated signing key looks just like a bad signature; refetch once
        // before deciding the token is actually invalid.
        identity = verifyIdToken(idToken, await getJwks(true), oauth, now)
      }
    } catch (error) {
      if (error instanceof DomainNotAllowedError) {
        failSignIn(res, `Only ${config.allowedDomain} accounts can use GetDone.`)
        return
      }
      console.error('Google sign-in failed:', error)
      failSignIn(res, 'Could not complete sign-in. Please try again.')
      return
    }

    const user = await userStore.signIn(identity)
    redirect(res, pending.returnTo, [
      createSessionCookie(user, config.sessionSecret, config.sessionTtlSeconds, secureCookies, now),
      clearPendingOAuthCookie(secureCookies),
    ])
  }

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://internal')

      if (req.method === 'GET' && url.pathname === '/healthz') {
        sendText(res, 200, 'healthy\n')
        return
      }

      if (!url.pathname.startsWith('/api/')) {
        sendJson(res, 404, { error: 'Not found' })
        return
      }

      // --- Public auth routes -------------------------------------------
      if (req.method === 'GET' && url.pathname === '/api/auth/login') {
        await handleLogin(req, res, url)
        return
      }

      if (req.method === 'GET' && url.pathname === '/api/auth/callback') {
        await handleCallback(req, res, url)
        return
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': clearSessionCookie(secureCookies) })
        res.end(JSON.stringify({ ok: true }))
        return
      }

      // /api/auth/me is how the app decides whether to show the sign-in
      // screen, so it answers for signed-out callers too rather than 401ing.
      const session: Session | null = readSession(req.headers.cookie, config.sessionSecret, now)
      if (req.method === 'GET' && url.pathname === '/api/auth/me') {
        sendJson(res, 200, { user: session, allowedDomain: config.allowedDomain })
        return
      }

      // --- Everything below requires a session ---------------------------
      if (!session) {
        sendJson(res, 401, { error: 'Unauthorized' })
        return
      }

      if (req.method === 'GET' && url.pathname === '/api/admin/users') {
        if (session.role !== 'superuser') {
          sendJson(res, 403, { error: 'Forbidden' })
          return
        }
        sendJson(res, 200, { users: await userStore.list() })
        return
      }

      // The key comes from the session, never from the request, so there is
      // no parameter a user could bend toward a teammate's snapshot.
      const store = openSnapshotStore(snapshotKeyFor(config.s3SnapshotPrefix, session.sub))

      if (req.method === 'GET' && url.pathname === '/api/snapshot/meta') {
        sendJson(res, 200, await store.head())
        return
      }

      if (req.method === 'GET' && url.pathname === '/api/snapshot') {
        const snapshot = await store.get()
        if (!snapshot) {
          sendJson(res, 404, { error: 'No snapshot found' })
          return
        }
        const stored = JSON.parse(snapshot.body) as EncryptedEnvelope & { updatedAt: string }
        const tasksJson = decryptPayload(stored, config.encryptionKey)
        sendJson(res, 200, { updatedAt: stored.updatedAt, tasks: JSON.parse(tasksJson) })
        return
      }

      if (req.method === 'PUT' && url.pathname === '/api/snapshot') {
        const body = await readJsonBody(req, MAX_BODY_BYTES)
        const payload = validatePayload(body)
        const envelope = encryptPayload(JSON.stringify(payload.tasks), config.encryptionKey)
        await store.put(JSON.stringify({ ...envelope, updatedAt: payload.updatedAt }), payload.updatedAt)
        sendJson(res, 200, { ok: true })
        return
      }

      sendJson(res, 404, { error: 'Not found' })
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(res, 413, { error: 'Payload too large' })
        return
      }
      if (error instanceof Error) {
        // validatePayload / body-parsing errors are client mistakes (400);
        // anything else (including decrypt failures) is unexpected and must
        // not leak details to the client.
        const isClientError = /must be|is required|Invalid JSON|exceeds maximum/.test(error.message)
        if (isClientError) {
          sendJson(res, 400, { error: error.message })
          return
        }
      }
      console.error('Unhandled request error:', error)
      sendJson(res, 500, { error: 'Internal server error' })
    }
  }
}

function main(): void {
  let config
  try {
    config = loadConfig()
  } catch (error) {
    console.error('Configuration error:', (error as Error).message)
    process.exit(1)
  }

  const s3Client: S3Client = createS3Client(process.env.AWS_REGION)
  const app = createApp({
    config,
    userStore: createS3UserStore(s3Client, config.s3Bucket, config.s3UsersKey),
    openSnapshotStore: (key) => createS3SnapshotStore(s3Client, config.s3Bucket, key),
  })

  const server = createServer(app)
  server.listen(config.port, () => {
    console.log(`getdone-sync listening on :${config.port} (domain ${config.allowedDomain})`)
  })
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  main()
}
