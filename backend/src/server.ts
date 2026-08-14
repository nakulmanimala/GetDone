import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { loadConfig } from './config.js'
import { createS3Client } from './s3Client.js'
import { createS3SnapshotStore, type SnapshotStore } from './snapshotStore.js'
import { isAuthorized } from './auth.js'
import { PayloadTooLargeError, readJsonBody, sendJson, sendText } from './httpUtils.js'
import { validateEnvelope } from './validate.js'

// Keep in sync with docker/nginx.conf's client_max_body_size for /api/.
const MAX_BODY_BYTES = 10 * 1024 * 1024

export function createApp(store: SnapshotStore, token: string) {
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://internal')

      if (req.method === 'GET' && url.pathname === '/healthz') {
        sendText(res, 200, 'healthy\n')
        return
      }

      if (!url.pathname.startsWith('/api/')) {
        sendJson(res, 404, { error: 'Not found' })
        return
      }

      if (!isAuthorized(req, token)) {
        sendJson(res, 401, { error: 'Unauthorized' })
        return
      }

      if (req.method === 'GET' && url.pathname === '/api/snapshot/meta') {
        sendJson(res, 200, await store.head())
        return
      }

      if (req.method === 'GET' && url.pathname === '/api/snapshot') {
        const snapshot = await store.get()
        if (!snapshot) {
          sendJson(res, 404, { error: 'No snapshot found' })
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(snapshot.body)
        return
      }

      if (req.method === 'PUT' && url.pathname === '/api/snapshot') {
        const body = await readJsonBody(req, MAX_BODY_BYTES)
        const envelope = validateEnvelope(body)
        await store.put(JSON.stringify(envelope), envelope.updatedAt)
        sendJson(res, 200, { ok: true })
        return
      }

      sendJson(res, 404, { error: 'Not found' })
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(res, 413, { error: 'Payload too large' })
        return
      }
      if (error instanceof Error) {
        // validateEnvelope / body-parsing errors are client mistakes (400);
        // anything else is unexpected and must not leak details to the client.
        const isClientError = /must be|Invalid JSON|exceeds maximum/.test(error.message)
        if (isClientError) {
          sendJson(res, 400, { error: error.message })
          return
        }
      }
      console.error('Unhandled request error:', error)
      sendJson(res, 500, { error: 'Internal server error' })
    }
  }
}

function main(): void {
  let config
  try {
    config = loadConfig()
  } catch (error) {
    console.error('Configuration error:', (error as Error).message)
    process.exit(1)
  }

  const s3Client = createS3Client(process.env.AWS_REGION)
  const store = createS3SnapshotStore(s3Client, config.s3Bucket, config.s3SnapshotKey)
  const app = createApp(store, config.syncApiToken)

  const server = createServer(app)
  server.listen(config.port, () => {
    console.log(`getdone-sync listening on :${config.port}`)
  })
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  main()
}
