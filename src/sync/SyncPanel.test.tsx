import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SyncPanel } from './SyncPanel'
import { setApiToken, setConfigured, setSalt } from './syncMeta'
import type { SyncStatus } from './syncStatus'
import type { Task } from '../domain/tasks'

const tasks: Task[] = [
  { id: '1', title: 'Buy milk', status: 'open', project: 'Inbox', priority: 'none', createdAt: '2026-01-01T00:00:00Z' },
]

function noop() {}

// Mirrors how App.tsx holds cryptoKey/status so onUnlock/onStatusChange updates re-render the panel.
function Harness({
  initialStatus = { kind: 'idle' },
  onApplyRemoteSnapshot = noop,
}: {
  initialStatus?: SyncStatus
  onApplyRemoteSnapshot?: (tasks: Task[], updatedAt: string) => void
}) {
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null)
  const [status, setStatus] = useState<SyncStatus>(initialStatus)
  return (
    <SyncPanel
      tasks={tasks}
      status={status}
      onStatusChange={setStatus}
      onApplyRemoteSnapshot={onApplyRemoteSnapshot}
      cryptoKey={cryptoKey}
      onUnlock={setCryptoKey}
      onClose={noop}
    />
  )
}

describe('SyncPanel', () => {
  beforeEach(() => localStorage.clear())

  it('shows the no-recovery warning before first-time setup', () => {
    render(<Harness />)
    expect(screen.getByText(/no password recovery/i)).toBeInTheDocument()
  })

  it('renders the conflict banner with Keep local / Keep S3 actions once unlocked', async () => {
    setConfigured(true)
    setSalt('c2FsdA==')
    setApiToken('token')
    const user = userEvent.setup()

    render(
      <Harness
        initialStatus={{ kind: 'conflict', localUpdatedAt: '2026-08-14T00:00:00.000Z', remoteUpdatedAt: '2026-08-14T00:00:00.000Z' }}
      />,
    )

    // Unlock first — the conflict banner only renders once a passphrase key is derived.
    await user.type(screen.getByLabelText(/passphrase/i), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: /unlock/i }))

    expect(await screen.findByText(/both changed since the last sync/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /keep local/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /keep s3/i })).toBeInTheDocument()
  })

  it('shows the auto backup hint once unlocked', async () => {
    setConfigured(true)
    setSalt('c2FsdA==')
    setApiToken('token')
    const user = userEvent.setup()

    render(<Harness />)

    await user.type(screen.getByLabelText(/passphrase/i), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: /unlock/i }))

    expect(await screen.findByText(/auto backup is on/i)).toBeInTheDocument()
  })

  it('requires confirmation before restoring over local tasks', async () => {
    setConfigured(true)
    setSalt('c2FsdA==')
    setApiToken('token')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onApplyRemoteSnapshot = vi.fn()
    const user = userEvent.setup()

    render(<Harness onApplyRemoteSnapshot={onApplyRemoteSnapshot} />)

    await user.type(screen.getByLabelText(/passphrase/i), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: /unlock/i }))
    await user.click(await screen.findByRole('button', { name: /restore from s3/i }))

    expect(confirmSpy).toHaveBeenCalled()
    expect(onApplyRemoteSnapshot).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })
})
