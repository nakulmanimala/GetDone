// @vitest-environment node
// jsdom does not implement SubtleCrypto; Node's native WebCrypto is used here instead.
import { describe, expect, it } from 'vitest'
import { DecryptionError, decryptSnapshot, deriveKey, encryptSnapshot, generateSaltBase64 } from './crypto'

describe('crypto', () => {
  it('round-trips plaintext through encrypt and decrypt', async () => {
    const salt = generateSaltBase64()
    const key = await deriveKey('correct horse battery staple', salt)
    const plaintext = JSON.stringify([{ id: '1', title: 'Buy milk' }])

    const { ciphertext, iv } = await encryptSnapshot(key, plaintext)
    const decrypted = await decryptSnapshot(key, ciphertext, iv)

    expect(decrypted).toBe(plaintext)
  })

  it('produces a fresh iv and ciphertext on every encryption', async () => {
    const salt = generateSaltBase64()
    const key = await deriveKey('same passphrase', salt)
    const plaintext = 'identical plaintext'

    const first = await encryptSnapshot(key, plaintext)
    const second = await encryptSnapshot(key, plaintext)

    expect(first.iv).not.toBe(second.iv)
    expect(first.ciphertext).not.toBe(second.ciphertext)
  })

  it('throws DecryptionError when the passphrase is wrong', async () => {
    const salt = generateSaltBase64()
    const key = await deriveKey('right passphrase', salt)
    const wrongKey = await deriveKey('wrong passphrase', salt)
    const { ciphertext, iv } = await encryptSnapshot(key, 'secret tasks')

    await expect(decryptSnapshot(wrongKey, ciphertext, iv)).rejects.toBeInstanceOf(DecryptionError)
  })

  it('throws DecryptionError on corrupted ciphertext', async () => {
    const salt = generateSaltBase64()
    const key = await deriveKey('passphrase', salt)
    const { iv } = await encryptSnapshot(key, 'secret tasks')

    await expect(decryptSnapshot(key, 'not-valid-base64-ciphertext!!', iv)).rejects.toBeInstanceOf(DecryptionError)
  })

  it('derives different keys from different salts', async () => {
    const plaintext = 'same plaintext'
    const keyA = await deriveKey('same passphrase', generateSaltBase64())
    const keyB = await deriveKey('same passphrase', generateSaltBase64())
    const { ciphertext, iv } = await encryptSnapshot(keyA, plaintext)

    await expect(decryptSnapshot(keyB, ciphertext, iv)).rejects.toBeInstanceOf(DecryptionError)
  })
})
