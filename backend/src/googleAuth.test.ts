import { createSign, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { base64UrlEncode } from './jwt.js'
import {
  buildAuthorizationUrl,
  createJwksCache,
  DomainNotAllowedError,
  exchangeCodeForIdToken,
  GoogleAuthError,
  statesMatch,
  verifyIdToken,
  type GoogleOAuthConfig,
} from './googleAuth.js'

const config: GoogleOAuthConfig = {
  clientId: 'client-123.apps.googleusercontent.com',
  clientSecret: 'secret',
  redirectUri: 'https://tasks.entri.me/api/auth/callback',
  allowedDomain: 'entri.me',
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'google-key', alg: 'RS256', use: 'sig' }
const NOW = Date.UTC(2026, 7, 15, 12, 0, 0)
const now = () => NOW

function issueIdToken(overrides: Record<string, unknown> = {}): string {
  const payload = {
    iss: 'https://accounts.google.com',
    aud: config.clientId,
    sub: '1234567890',
    email: 'nakul@entri.me',
    email_verified: true,
    hd: 'entri.me',
    name: 'Nakul P',
    iat: Math.floor(NOW / 1000) - 10,
    exp: Math.floor(NOW / 1000) + 3600,
    ...overrides,
  }
  const signingInput = `${base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'google-key' }))}.${base64UrlEncode(JSON.stringify(payload))}`
  return `${signingInput}.${base64UrlEncode(createSign('RSA-SHA256').update(signingInput).sign(privateKey))}`
}

describe('buildAuthorizationUrl', () => {
  it('requests the openid scopes with PKCE and the workspace hint', () => {
    const { url, state, codeVerifier } = buildAuthorizationUrl(config)
    const params = new URL(url).searchParams

    expect(params.get('client_id')).toBe(config.clientId)
    expect(params.get('redirect_uri')).toBe(config.redirectUri)
    expect(params.get('response_type')).toBe('code')
    expect(params.get('scope')).toBe('openid email profile')
    expect(params.get('code_challenge_method')).toBe('S256')
    expect(params.get('hd')).toBe('entri.me')
    expect(params.get('state')).toBe(state)
    expect(codeVerifier).not.toBe('')
    // The verifier itself must never travel to the browser's address bar.
    expect(url).not.toContain(codeVerifier)
  })

  it('generates a fresh state and verifier per attempt', () => {
    const first = buildAuthorizationUrl(config)
    const second = buildAuthorizationUrl(config)
    expect(first.state).not.toBe(second.state)
    expect(first.codeVerifier).not.toBe(second.codeVerifier)
  })
})

describe('statesMatch', () => {
  it('accepts an exact match and rejects anything else', () => {
    expect(statesMatch('abc', 'abc')).toBe(true)
    expect(statesMatch('abc', 'abd')).toBe(false)
    expect(statesMatch('abc', 'ab')).toBe(false)
    expect(statesMatch('', '')).toBe(false)
  })
})

describe('exchangeCodeForIdToken', () => {
  it('posts the code with the verifier and returns the id_token', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ id_token: 'the-token' }), { status: 200 }))

    const token = await exchangeCodeForIdToken(config, 'auth-code', 'verifier', fetchFn)

    expect(token).toBe('the-token')
    const body = new URLSearchParams(fetchFn.mock.calls[0][1]?.body as string)
    expect(body.get('code')).toBe('auth-code')
    expect(body.get('code_verifier')).toBe('verifier')
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('client_secret')).toBe('secret')
  })

  it('fails without echoing the response body, which can contain the secret', async () => {
    const fetchFn = vi.fn(async () => new Response('{"error":"invalid_grant","client_secret":"secret"}', { status: 400 }))

    await expect(exchangeCodeForIdToken(config, 'bad', 'verifier', fetchFn)).rejects.toThrow(GoogleAuthError)
    await expect(exchangeCodeForIdToken(config, 'bad', 'verifier', fetchFn)).rejects.not.toThrow(/secret/)
  })

  it('rejects a 200 response with no id_token', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ access_token: 'x' }), { status: 200 }))
    await expect(exchangeCodeForIdToken(config, 'code', 'verifier', fetchFn)).rejects.toThrow(/no id_token/)
  })
})

describe('createJwksCache', () => {
  it('fetches once and serves the cached keys afterwards', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }))
    const getKeys = createJwksCache(fetchFn, now)

    await getKeys()
    await getKeys()

    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('refetches after the cache expires', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }))
    let clock = NOW
    const getKeys = createJwksCache(fetchFn, () => clock)

    await getKeys()
    clock += 2 * 60 * 60 * 1000
    await getKeys()

    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('refetches on demand, so a rotated key can be picked up mid-hour', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }))
    const getKeys = createJwksCache(fetchFn, now)

    await getKeys()
    await getKeys(true)

    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('rejects an empty key set rather than caching it', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ keys: [] }), { status: 200 }))
    await expect(createJwksCache(fetchFn, now)()).rejects.toThrow(/empty/)
  })
})

describe('verifyIdToken', () => {
  it('accepts a well-formed entri.me identity', () => {
    expect(verifyIdToken(issueIdToken(), [jwk], config, now)).toEqual({
      sub: '1234567890',
      email: 'nakul@entri.me',
      name: 'Nakul P',
      picture: undefined,
    })
  })

  it('falls back to the email when Google sends no name', () => {
    expect(verifyIdToken(issueIdToken({ name: undefined }), [jwk], config, now).name).toBe('nakul@entri.me')
  })

  // The domain restriction — the reason this feature exists.
  it('rejects an account outside the allowed domain', () => {
    const token = issueIdToken({ email: 'someone@gmail.com', hd: undefined })
    expect(() => verifyIdToken(token, [jwk], config, now)).toThrow(DomainNotAllowedError)
  })

  it('rejects a personal account whose email merely looks like the domain', () => {
    // No hd claim means it is not a Workspace account, whatever the address says.
    const token = issueIdToken({ email: 'impostor@entri.me', hd: undefined })
    expect(() => verifyIdToken(token, [jwk], config, now)).toThrow(DomainNotAllowedError)
  })

  it('rejects an hd claim for a different workspace', () => {
    const token = issueIdToken({ hd: 'evil.example', email: 'user@evil.example' })
    expect(() => verifyIdToken(token, [jwk], config, now)).toThrow(DomainNotAllowedError)
  })

  it('rejects a spoofed hd that disagrees with the email domain', () => {
    const token = issueIdToken({ hd: 'entri.me', email: 'user@evil.example' })
    expect(() => verifyIdToken(token, [jwk], config, now)).toThrow(DomainNotAllowedError)
  })

  it('rejects an unverified email', () => {
    expect(() => verifyIdToken(issueIdToken({ email_verified: false }), [jwk], config, now)).toThrow(/not verified|not verified this/i)
  })

  it('rejects a token minted for another client', () => {
    expect(() => verifyIdToken(issueIdToken({ aud: 'other-client' }), [jwk], config, now)).toThrow(/different client/)
  })

  it('rejects a token from the wrong issuer', () => {
    expect(() => verifyIdToken(issueIdToken({ iss: 'https://evil.example' }), [jwk], config, now)).toThrow(/issuer/)
  })

  it('rejects an expired token but tolerates small clock skew', () => {
    const expiring = issueIdToken({ exp: Math.floor(NOW / 1000) - 30 })
    expect(verifyIdToken(expiring, [jwk], config, now).sub).toBe('1234567890')

    const expired = issueIdToken({ exp: Math.floor(NOW / 1000) - 300 })
    expect(() => verifyIdToken(expired, [jwk], config, now)).toThrow(/expired/)
  })

  it('rejects a token issued far in the future', () => {
    const token = issueIdToken({ iat: Math.floor(NOW / 1000) + 600 })
    expect(() => verifyIdToken(token, [jwk], config, now)).toThrow(/future/)
  })

  it('rejects a token signed by a key outside Google key set', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const otherJwk = { ...other.publicKey.export({ format: 'jwk' }), kid: 'google-key', alg: 'RS256', use: 'sig' }
    expect(() => verifyIdToken(issueIdToken(), [otherJwk], config, now)).toThrow(/signature/)
  })
})
