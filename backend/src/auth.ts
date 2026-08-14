import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

const BEARER_PREFIX = 'Bearer '

export function isAuthorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization
  if (!header || !header.startsWith(BEARER_PREFIX)) return false

  const provided = header.slice(BEARER_PREFIX.length)
  // Hash both sides to fixed-length digests first: timingSafeEqual throws on
  // length mismatch, and hashing avoids leaking the token's length via that.
  const providedHash = createHash('sha256').update(provided).digest()
  const expectedHash = createHash('sha256').update(token).digest()
  return timingSafeEqual(providedHash, expectedHash)
}
