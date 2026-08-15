export interface CookieOptions {
  maxAgeSeconds: number
  secure: boolean
  sameSite?: 'Lax' | 'Strict' | 'None'
  path?: string
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  const cookies: Record<string, string> = {}
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 1) continue
    const name = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (!name || name in cookies) continue // first wins, as browsers do
    try {
      cookies[name] = decodeURIComponent(value)
    } catch {
      cookies[name] = value
    }
  }
  return cookies
}

// httpOnly on every cookie we set: nothing here is meant to be read by page
// JavaScript, which keeps session theft out of reach of an XSS bug.
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path ?? '/'}`,
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
    'HttpOnly',
    `SameSite=${options.sameSite ?? 'Lax'}`,
  ]
  if (options.secure) parts.push('Secure')
  return parts.join('; ')
}

export function expireCookie(name: string, secure: boolean): string {
  return serializeCookie(name, '', { maxAgeSeconds: 0, secure })
}
