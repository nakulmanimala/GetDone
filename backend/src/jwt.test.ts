import { generateKeyPairSync, createSign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { base64UrlEncode, JwtError, signHs256, verifyHs256, verifyRs256 } from './jwt.js'

const SECRET = 'test-session-secret'
const FUTURE = Math.floor(Date.now() / 1000) + 3600
const PAST = Math.floor(Date.now() / 1000) - 1

describe('HS256 session tokens', () => {
  it('round trips a payload', () => {
    const token = signHs256({ sub: 'user-1', exp: FUTURE }, SECRET)
    expect(verifyHs256(token, SECRET)).toMatchObject({ sub: 'user-1' })
  })

  it('rejects a token signed with a different secret', () => {
    const token = signHs256({ sub: 'user-1', exp: FUTURE }, 'other-secret')
    expect(verifyHs256(token, SECRET)).toBeNull()
  })

  it('rejects a tampered payload', () => {
    const token = signHs256({ sub: 'user-1', role: 'member', exp: FUTURE }, SECRET)
    const [header, , signature] = token.split('.')
    const forged = base64UrlEncode(JSON.stringify({ sub: 'user-1', role: 'superuser', exp: FUTURE }))
    expect(verifyHs256(`${header}.${forged}.${signature}`, SECRET)).toBeNull()
  })

  it('rejects an expired token', () => {
    expect(verifyHs256(signHs256({ sub: 'user-1', exp: PAST }, SECRET), SECRET)).toBeNull()
  })

  it('rejects a token with no expiry rather than treating it as eternal', () => {
    expect(verifyHs256(signHs256({ sub: 'user-1' }, SECRET), SECRET)).toBeNull()
  })

  it('rejects "alg: none" even when the signature is empty', () => {
    const header = base64UrlEncode(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    const payload = base64UrlEncode(JSON.stringify({ sub: 'attacker', exp: FUTURE }))
    expect(verifyHs256(`${header}.${payload}.`, SECRET)).toBeNull()
  })

  it('rejects malformed input instead of throwing', () => {
    expect(verifyHs256('not-a-token', SECRET)).toBeNull()
    expect(verifyHs256('a.b', SECRET)).toBeNull()
    expect(verifyHs256('', SECRET)).toBeNull()
  })
})

describe('RS256 identity tokens', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'key-1', alg: 'RS256', use: 'sig' }

  function issue(payload: Record<string, unknown>, kid = 'key-1'): string {
    const signingInput = `${base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }))}.${base64UrlEncode(JSON.stringify(payload))}`
    const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey)
    return `${signingInput}.${base64UrlEncode(signature)}`
  }

  it('verifies a token signed by the matching key', () => {
    expect(verifyRs256(issue({ sub: 'google-1' }), [jwk])).toMatchObject({ sub: 'google-1' })
  })

  it('rejects a token whose key id is not in the key set', () => {
    expect(() => verifyRs256(issue({ sub: 'google-1' }, 'unknown-kid'), [jwk])).toThrow(JwtError)
  })

  it('rejects a token with a swapped payload', () => {
    const token = issue({ sub: 'google-1', hd: 'entri.me' })
    const [header, , signature] = token.split('.')
    const forged = base64UrlEncode(JSON.stringify({ sub: 'google-1', hd: 'attacker.example' }))
    expect(() => verifyRs256(`${header}.${forged}.${signature}`, [jwk])).toThrow(JwtError)
  })

  // The classic downgrade: re-sign the token with HMAC using the public key as
  // the shared secret. Pinning alg to RS256 is what stops it.
  it('refuses to fall back to HS256', () => {
    const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'key-1' }))
    const payload = base64UrlEncode(JSON.stringify({ sub: 'attacker' }))
    const forged = signHs256({ sub: 'attacker' }, 'irrelevant')
    expect(() => verifyRs256(`${header}.${payload}.${forged.split('.')[2]}`, [jwk])).toThrow(/algorithm/i)
  })

  it('rejects a token with no key id', () => {
    const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const payload = base64UrlEncode(JSON.stringify({ sub: 'x' }))
    expect(() => verifyRs256(`${header}.${payload}.AAAA`, [jwk])).toThrow(/key id/i)
  })
})
