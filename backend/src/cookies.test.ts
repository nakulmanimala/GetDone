import { describe, expect, it } from 'vitest'
import { expireCookie, parseCookies, serializeCookie } from './cookies.js'

describe('parseCookies', () => {
  it('parses a multi-cookie header', () => {
    expect(parseCookies('a=1; b=two')).toEqual({ a: '1', b: 'two' })
  })

  it('handles an absent or empty header', () => {
    expect(parseCookies(undefined)).toEqual({})
    expect(parseCookies('')).toEqual({})
  })

  it('decodes percent-encoded values', () => {
    expect(parseCookies('email=nakul%40entri.me')).toEqual({ email: 'nakul@entri.me' })
  })

  it('keeps a malformed encoding verbatim instead of throwing', () => {
    expect(parseCookies('broken=%E0%A4%A')).toEqual({ broken: '%E0%A4%A' })
  })

  it('keeps the first value when a name repeats', () => {
    expect(parseCookies('sid=real; sid=injected')).toEqual({ sid: 'real' })
  })

  it('ignores valueless fragments', () => {
    expect(parseCookies('novalue; a=1; =orphan')).toEqual({ a: '1' })
  })

  it('preserves "=" inside a value', () => {
    expect(parseCookies('t=abc.def==')).toEqual({ t: 'abc.def==' })
  })
})

describe('serializeCookie', () => {
  it('always marks the cookie HttpOnly and SameSite=Lax by default', () => {
    const cookie = serializeCookie('sid', 'value', { maxAgeSeconds: 60, secure: true })
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('Max-Age=60')
    expect(cookie).toContain('Path=/')
  })

  it('omits Secure when served over plain http, so local dev still works', () => {
    expect(serializeCookie('sid', 'value', { maxAgeSeconds: 60, secure: false })).not.toContain('Secure')
  })

  it('encodes the value', () => {
    expect(serializeCookie('sid', 'a b@c', { maxAgeSeconds: 60, secure: false })).toContain('sid=a%20b%40c')
  })

  it('expires a cookie with Max-Age=0', () => {
    expect(expireCookie('sid', true)).toContain('Max-Age=0')
  })
})
