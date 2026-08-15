export interface Config {
  port: number
  s3Bucket: string
  /** Prefix under which each user's snapshot lives; see snapshotKeyFor. */
  s3SnapshotPrefix: string
  s3UsersKey: string
  encryptionKey: Buffer
  sessionSecret: string
  sessionTtlSeconds: number
  appOrigin: string
  googleClientId: string
  googleClientSecret: string
  allowedDomain: string
}

const DEFAULT_PORT = 8081
const DEFAULT_SNAPSHOT_PREFIX = 'getdone/users'
const DEFAULT_USERS_KEY = 'getdone/users.json'
const DEFAULT_ALLOWED_DOMAIN = 'entri.me'
const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

/**
 * Each user's tasks live under their own Google subject id, which is what
 * keeps one teammate's list unreadable to another: the key is derived from
 * the session, never from anything the client sends.
 */
export function snapshotKeyFor(prefix: string, sub: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(sub)) {
    // Google subs are digits today, but a key built from an unvalidated string
    // is a path-traversal waiting to happen (`../` into someone else's object).
    throw new Error('Invalid user id')
  }
  return `${prefix.replace(/\/+$/, '')}/${sub}/snapshot.json.enc`
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const s3Bucket = required(env, 'S3_BUCKET')
  const googleClientId = required(env, 'GOOGLE_CLIENT_ID')
  const googleClientSecret = required(env, 'GOOGLE_CLIENT_SECRET')
  const sessionSecret = required(env, 'SESSION_SECRET')
  if (sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters')
  }

  const appOrigin = required(env, 'APP_ORIGIN').replace(/\/+$/, '')
  let parsedOrigin: URL
  try {
    parsedOrigin = new URL(appOrigin)
  } catch {
    throw new Error('APP_ORIGIN must be an absolute URL, for example https://tasks.entri.me')
  }
  if (parsedOrigin.protocol !== 'https:' && parsedOrigin.hostname !== 'localhost' && parsedOrigin.hostname !== '127.0.0.1') {
    // Google refuses non-HTTPS redirect URIs except on localhost, and the
    // session cookie would travel unprotected. Fail loudly at boot instead.
    throw new Error('APP_ORIGIN must use https except on localhost')
  }

  const encryptionKeyBase64 = required(env, 'SYNC_ENCRYPTION_KEY')
  const encryptionKey = Buffer.from(encryptionKeyBase64, 'base64')
  if (encryptionKey.length !== 32) {
    throw new Error('SYNC_ENCRYPTION_KEY must decode to 32 bytes (base64-encoded AES-256 key)')
  }

  const port = Number(env.PORT)
  const ttl = Number(env.SESSION_TTL_SECONDS)

  return {
    port: Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT,
    s3Bucket,
    s3SnapshotPrefix: env.S3_SNAPSHOT_PREFIX?.trim() || DEFAULT_SNAPSHOT_PREFIX,
    s3UsersKey: env.S3_USERS_KEY?.trim() || DEFAULT_USERS_KEY,
    encryptionKey,
    sessionSecret,
    sessionTtlSeconds: Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_SESSION_TTL_SECONDS,
    appOrigin,
    googleClientId,
    googleClientSecret,
    allowedDomain: env.GOOGLE_ALLOWED_DOMAIN?.trim() || DEFAULT_ALLOWED_DOMAIN,
  }
}
