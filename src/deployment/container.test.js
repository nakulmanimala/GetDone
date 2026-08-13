import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const nginxConfig = readFileSync('docker/nginx.conf', 'utf8')
const dockerfile = readFileSync('Dockerfile', 'utf8')

describe('production web container', () => {
  it('serves client routes through the SPA entry point', () => {
    expect(nginxConfig).toContain('try_files $uri $uri/ /index.html')
  })

  it('provides a lightweight health endpoint', () => {
    expect(nginxConfig).toContain('location = /healthz')
    expect(nginxConfig).toContain('return 200 "healthy\\n"')
  })

  it('does not cache the HTML application shell', () => {
    expect(nginxConfig).toContain('location = /index.html')
    expect(nginxConfig).toContain('Cache-Control "no-store"')
  })

  it('keeps security headers on the HTML location that overrides headers', () => {
    const indexLocation = nginxConfig.match(/location = \/index\.html \{([\s\S]*?)\n    \}/)?.[1] ?? ''
    expect(indexLocation).toContain('X-Content-Type-Options "nosniff"')
    expect(indexLocation).toContain('X-Frame-Options "DENY"')
    expect(indexLocation).toContain('Referrer-Policy "strict-origin-when-cross-origin"')
    expect(indexLocation).toContain('Permissions-Policy "camera=(), microphone=(), geolocation=()"')
  })

  it('runs the production server as an unprivileged image', () => {
    expect(dockerfile).toContain('nginxinc/nginx-unprivileged')
    expect(dockerfile).toContain('EXPOSE 8080')
  })

  it('gives the unprivileged server a writable temporary cache', () => {
    const compose = readFileSync('compose.yaml', 'utf8')
    expect(compose).toContain('/var/cache/nginx:size=16m,mode=1777')
  })
})
