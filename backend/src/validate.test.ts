import { describe, expect, it } from 'vitest'
import { validateEnvelope } from './validate'

const validEnvelope = {
  schemaVersion: 1,
  kdfName: 'PBKDF2-SHA256',
  kdfIterations: 250_000,
  salt: 'c2FsdA==',
  iv: 'aXY=',
  updatedAt: '2026-08-14T00:00:00.000Z',
  ciphertext: 'Y2lwaGVydGV4dA==',
}

describe('validateEnvelope', () => {
  it('accepts a well-formed envelope', () => {
    expect(validateEnvelope(validEnvelope)).toEqual(validEnvelope)
  })

  it('rejects a non-object', () => {
    expect(() => validateEnvelope('nope')).toThrow()
    expect(() => validateEnvelope(null)).toThrow()
  })

  it.each(Object.keys(validEnvelope))('rejects a missing %s', (field) => {
    const rest = { ...validEnvelope } as Record<string, unknown>
    delete rest[field]
    expect(() => validateEnvelope(rest)).toThrow()
  })

  it('rejects a non-ISO updatedAt', () => {
    expect(() => validateEnvelope({ ...validEnvelope, updatedAt: 'not-a-date' })).toThrow()
  })

  it('rejects non-positive kdfIterations', () => {
    expect(() => validateEnvelope({ ...validEnvelope, kdfIterations: 0 })).toThrow()
  })

  it('rejects an oversized ciphertext', () => {
    expect(() => validateEnvelope({ ...validEnvelope, ciphertext: 'a'.repeat(9 * 1024 * 1024) })).toThrow()
  })
})
