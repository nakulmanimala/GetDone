import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const nginxConfig = readFileSync('docker/nginx.conf', 'utf8')
const compose = readFileSync('compose.yaml', 'utf8')
const backendDockerfile = readFileSync('backend/Dockerfile', 'utf8')
const envExample = readFileSync('.env.example', 'utf8')

describe('sync backend service', () => {
  it('proxies /api/ to the sync service over the compose network', () => {
    const apiLocation = nginxConfig.match(/location \/api\/ \{([\s\S]*?)\n    \}/)?.[1] ?? ''
    expect(apiLocation).toContain('proxy_pass http://sync:8081/api/')
  })

  it('caps the api request body size', () => {
    const apiLocation = nginxConfig.match(/location \/api\/ \{([\s\S]*?)\n    \}/)?.[1] ?? ''
    expect(apiLocation).toContain('client_max_body_size')
  })

  it('runs the sync service hardened like the web service', () => {
    const syncService = compose.match(/\n {2}sync:\n([\s\S]*?)(?=\n {2}\S|\n*$)/)?.[1] ?? ''
    expect(syncService).toContain('read_only: true')
    expect(syncService).toContain('cap_drop')
    expect(syncService).toContain('- ALL')
    expect(syncService).toContain('no-new-privileges:true')
  })

  it('mounts the host AWS profile read-only into the sync service', () => {
    const syncService = compose.match(/\n {2}sync:\n([\s\S]*?)(?=\n {2}\S|\n*$)/)?.[1] ?? ''
    expect(syncService).toContain('${HOME}/.aws:/home/getdone/.aws:ro')
  })

  it('does not publish a host port for the sync service', () => {
    const syncService = compose.match(/\n {2}sync:\n([\s\S]*?)(?=\n {2}\S|\n*$)/)?.[1] ?? ''
    expect(syncService).not.toContain('ports:')
  })

  it('runs the sync backend as an unprivileged, non-root user', () => {
    expect(backendDockerfile).toContain('USER getdone')
    expect(backendDockerfile).toContain('EXPOSE 8081')
  })

  it('documents the required sync environment variables', () => {
    expect(envExample).toContain('S3_BUCKET=')
    expect(envExample).toContain('S3_SNAPSHOT_KEY=')
    expect(envExample).toContain('SYNC_API_TOKEN=')
    expect(envExample).toContain('SYNC_ENCRYPTION_KEY=')
    expect(envExample).toContain('AWS_PROFILE=')
  })
})
