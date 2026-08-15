import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SyncPanel } from './SyncPanel'
import { setApiToken, setConfigured } from './syncMeta'
import type { SyncStatus } from './syncStatus'
import { ConfirmDialog, type ConfirmRequest } from '../components/ConfirmDialog'
import type { Task } from '../domain/tasks'

const tasks: Task[] = [
  { id: '1', title: 'Buy milk', status: 'open', project: 'Inbox', createdAt: '2026-01-01T00:00:00Z' },
]

function noop() {}

// Mirrors how App.tsx wires the panel: it holds the status, and it owns the
// single themed confirm dialog the panel asks for.
function Harness({
  initialStatus = { kind: 'idle' },
  onApplyRemoteSnapshot = noop,
  onConfigured = noop,
}: {
  initialStatus?: SyncStatus
  onApplyRemoteSnapshot?: (tasks: Task[], updatedAt: string) => void
  onConfigured?: () => void
}) {
  const [status, setStatus] = useState<SyncStatus>(initialStatus)
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)
  return (
    <>
      <SyncPanel
        tasks={tasks}
        status={status}
        onStatusChange={setStatus}
        onApplyRemoteSnapshot={onApplyRemoteSnapshot}
        onConfigured={onConfigured}
        onClose={noop}
        requestConfirm={setConfirmRequest}
      />
      {confirmRequest && (
        <ConfirmDialog
          request={confirmRequest}
          onConfirm={() => { confirmRequest.action(); setConfirmRequest(null) }}
          onCancel={() => setConfirmRequest(null)}
        />
      )}
    </>
  )
}

describe('SyncPanel', () => {
  beforeEach(() => localStorage.clear())

  it('shows only the API token setup form before first-time setup, no passphrase', () => {
    render(<Harness />)
    expect(screen.getByLabelText(/api token/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/passphrase/i)).not.toBeInTheDocument()
  })

  it('renders the conflict banner with Keep local / Keep S3 actions once configured', () => {
    setConfigured(true)
    setApiToken('token')

    render(
      <Harness
        initialStatus={{ kind: 'conflict', localUpdatedAt: '2026-08-14T00:00:00.000Z', remoteUpdatedAt: '2026-08-14T00:00:00.000Z' }}
      />,
    )

    expect(screen.getByText(/both changed since the last sync/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /keep local/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /keep s3/i })).toBeInTheDocument()
  })

  it('shows the auto backup hint once configured, with no unlock step', () => {
    setConfigured(true)
    setApiToken('token')

    render(<Harness />)

    expect(screen.getByText(/auto backup is on/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /unlock/i })).not.toBeInTheDocument()
  })

  it('asks for confirmation in the themed dialog, not the browser one', async () => {
    setConfigured(true)
    setApiToken('token')
    const confirmSpy = vi.spyOn(window, 'confirm')
    const onApplyRemoteSnapshot = vi.fn()
    const user = userEvent.setup()

    render(<Harness onApplyRemoteSnapshot={onApplyRemoteSnapshot} />)

    await user.click(screen.getByRole('button', { name: /restore from s3/i }))

    const dialog = screen.getByRole('alertdialog', { name: /restore from s3\?/i })
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveTextContent(/replaced by the S3 backup/i)
    expect(confirmSpy).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('does not restore when the confirmation is dismissed', async () => {
    setConfigured(true)
    setApiToken('token')
    const onApplyRemoteSnapshot = vi.fn()
    const user = userEvent.setup()

    render(<Harness onApplyRemoteSnapshot={onApplyRemoteSnapshot} />)

    await user.click(screen.getByRole('button', { name: /restore from s3/i }))
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onApplyRemoteSnapshot).not.toHaveBeenCalled()
  })

  it('reports an empty token in the panel instead of a browser validation bubble', async () => {
    const onConfigured = vi.fn()
    const user = userEvent.setup()

    render(<Harness onConfigured={onConfigured} />)

    await user.click(screen.getByRole('button', { name: /set up s3 backup/i }))

    expect(screen.getByText('An API token is required.')).toBeInTheDocument()
    expect(onConfigured).not.toHaveBeenCalled()
  })

  it('calls onConfigured after submitting the setup form', async () => {
    const onConfigured = vi.fn()
    const user = userEvent.setup()

    render(<Harness onConfigured={onConfigured} />)

    await user.type(screen.getByLabelText(/api token/i), 'my-token')
    await user.click(screen.getByRole('button', { name: /set up s3 backup/i }))

    expect(onConfigured).toHaveBeenCalled()
  })
})
