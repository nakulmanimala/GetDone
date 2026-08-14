import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptPayload, encryptPayload } from './snapshotCrypto'

describe('snapshotCrypto', () => {
  it('round-trips plaintext through encrypt and decrypt', () => {
    const key = randomBytes(32)
    const plaintext = JSON.stringify([{ id: '1', title: 'Buy milk' }])

    const envelope = encryptPayload(plaintext, key)
    expect(decryptPayload(envelope, key)).toBe(plaintext)
  })

  it('produces a fresh iv and ciphertext on every encryption', () => {
    const key = randomBytes(32)
    const plaintext = 'identical plaintext'

    const first = encryptPayload(plaintext, key)
    const second = encryptPayload(plaintext, key)

    expect(first.iv).not.toBe(second.iv)
    expect(first.ciphertext).not.toBe(second.ciphertext)
  })

  it('throws when decrypting with the wrong key', () => {
    const envelope = encryptPayload('secret tasks', randomBytes(32))
    expect(() => decryptPayload(envelope, randomBytes(32))).toThrow()
  })

  it('throws when the ciphertext has been tampered with', () => {
    const key = randomBytes(32)
    const envelope = encryptPayload('secret tasks', key)
    const tampered = { ...envelope, ciphertext: Buffer.from('tampered-data').toString('base64') }
    expect(() => decryptPayload(tampered, key)).toThrow()
  })
})
