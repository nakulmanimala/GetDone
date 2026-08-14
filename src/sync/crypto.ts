const PBKDF2_ITERATIONS = 250_000
const SALT_BYTES = 16
const IV_BYTES = 12

export class DecryptionError extends Error {
  constructor(message = 'Wrong passphrase, or the backup is corrupted.', options?: ErrorOptions) {
    super(message, options)
    this.name = 'DecryptionError'
  }
}

export function generateSaltBase64(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)))
}

export async function deriveKey(
  passphrase: string,
  saltBase64: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: base64ToBytes(saltBase64), iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptSnapshot(
  key: CryptoKey,
  plaintext: string,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const buffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  return { ciphertext: bytesToBase64(new Uint8Array(buffer)), iv: bytesToBase64(iv) }
}

export async function decryptSnapshot(key: CryptoKey, ciphertextBase64: string, ivBase64: string): Promise<string> {
  try {
    const buffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(ivBase64) },
      key,
      base64ToBytes(ciphertextBase64),
    )
    return new TextDecoder().decode(buffer)
  } catch (error) {
    throw new DecryptionError(undefined, { cause: error })
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
