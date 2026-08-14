import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12

export interface EncryptedEnvelope {
  schemaVersion: number
  iv: string
  authTag: string
  ciphertext: string
}

export function encryptPayload(plaintext: string, key: Buffer): EncryptedEnvelope {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    schemaVersion: 1,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

export function decryptPayload(envelope: EncryptedEnvelope, key: Buffer): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()])
  return plaintext.toString('utf8')
}
