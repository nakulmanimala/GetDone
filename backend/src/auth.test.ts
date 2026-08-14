import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { isAuthorized } from './auth'

function fakeRequest(headers: Record<string, string>): IncomingMessage {
  return { headers } as IncomingMessage
}

describe('isAuthorized', () => {
  it('accepts a matching bearer token', () => {
    expect(isAuthorized(fakeRequest({ authorization: 'Bearer secret' }), 'secret')).toBe(true)
  })

  it('rejects a mismatched token', () => {
    expect(isAuthorized(fakeRequest({ authorization: 'Bearer wrong' }), 'secret')).toBe(false)
  })

  it('rejects a missing header', () => {
    expect(isAuthorized(fakeRequest({}), 'secret')).toBe(false)
  })

  it('rejects a non-bearer header', () => {
    expect(isAuthorized(fakeRequest({ authorization: 'Basic secret' }), 'secret')).toBe(false)
  })

  it('rejects tokens of a different length without throwing', () => {
    expect(isAuthorized(fakeRequest({ authorization: 'Bearer short' }), 'a-much-longer-secret-token')).toBe(false)
  })
})
