import { createHmac, createPublicKey, createVerify, timingSafeEqual, type JsonWebKey } from 'node:crypto'

// Minimal JWT support, hand-rolled the same way snapshotCrypto is, so the sync
// container keeps its single dependency. Two directions are needed:
//
//   HS256 — signing and verifying our own session cookies.
//   RS256 — verifying Google's ID tokens against their published JWKS.
//
// Both verifiers pin the algorithm from the *expected* side rather than
// trusting the token header, which is what makes "alg: none" and
// RS256→HS256 confusion attacks impossible here.

export class JwtError extends Error {}

export function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

export function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url')
}

function encodeSegment(value: unknown): string {
  return base64UrlEncode(JSON.stringify(value))
}

function decodeSegment(segment: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(base64UrlDecode(segment).toString('utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new JwtError('Malformed token segment')
  }
  return parsed as Record<string, unknown>
}

function splitToken(token: string): { header: Record<string, unknown>; payload: Record<string, unknown>; signingInput: string; signature: Buffer } {
  const parts = token.split('.')
  if (parts.length !== 3) throw new JwtError('Malformed token')
  const [headerSegment, payloadSegment, signatureSegment] = parts
  return {
    header: decodeSegment(headerSegment),
    payload: decodeSegment(payloadSegment),
    signingInput: `${headerSegment}.${payloadSegment}`,
    signature: base64UrlDecode(signatureSegment),
  }
}

/** Signs a compact JWS with HMAC-SHA256. */
export function signHs256(payload: Record<string, unknown>, secret: string): string {
  const signingInput = `${encodeSegment({ alg: 'HS256', typ: 'JWT' })}.${encodeSegment(payload)}`
  const signature = createHmac('sha256', secret).update(signingInput).digest()
  return `${signingInput}.${base64UrlEncode(signature)}`
}

/**
 * Verifies an HS256 token and its `exp`. Returns null rather than throwing:
 * an expired or tampered session cookie is an ordinary "signed out", not an
 * error worth surfacing.
 */
export function verifyHs256(token: string, secret: string, now: () => number = Date.now): Record<string, unknown> | null {
  let parsed
  try {
    parsed = splitToken(token)
  } catch {
    return null
  }

  if (parsed.header.alg !== 'HS256') return null

  const expected = createHmac('sha256', secret).update(parsed.signingInput).digest()
  if (parsed.signature.length !== expected.length) return null
  if (!timingSafeEqual(parsed.signature, expected)) return null

  const exp = parsed.payload.exp
  if (typeof exp !== 'number' || exp * 1000 <= now()) return null

  return parsed.payload
}

/**
 * Verifies an RS256 token against a set of JWKs, selecting by `kid`.
 * Signature only — claim checks are the caller's job (see googleAuth).
 */
export function verifyRs256(token: string, keys: JsonWebKey[]): Record<string, unknown> {
  const parsed = splitToken(token)
  if (parsed.header.alg !== 'RS256') throw new JwtError(`Unexpected token algorithm: ${String(parsed.header.alg)}`)

  const kid = parsed.header.kid
  // Without a kid we cannot know which key signed it; trying every key would
  // still be sound, but Google always sends one, so its absence is suspect.
  if (typeof kid !== 'string') throw new JwtError('Token is missing a key id')

  const jwk = keys.find((key) => (key as { kid?: string }).kid === kid)
  if (!jwk) throw new JwtError('No signing key matches the token key id')

  const publicKey = createPublicKey({ key: jwk, format: 'jwk' })
  const verified = createVerify('RSA-SHA256').update(parsed.signingInput).verify(publicKey, parsed.signature)
  if (!verified) throw new JwtError('Token signature is invalid')

  return parsed.payload
}
