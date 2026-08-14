export interface Config {
  port: number
  s3Bucket: string
  s3SnapshotKey: string
  syncApiToken: string
}

const DEFAULT_PORT = 8081
const DEFAULT_SNAPSHOT_KEY = 'getdone/snapshot.json.enc'

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const s3Bucket = env.S3_BUCKET?.trim()
  if (!s3Bucket) {
    throw new Error('S3_BUCKET is required')
  }

  const syncApiToken = env.SYNC_API_TOKEN?.trim()
  if (!syncApiToken) {
    throw new Error('SYNC_API_TOKEN is required')
  }

  const port = Number(env.PORT)

  return {
    port: Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT,
    s3Bucket,
    s3SnapshotKey: env.S3_SNAPSHOT_KEY?.trim() || DEFAULT_SNAPSHOT_KEY,
    syncApiToken,
  }
}
