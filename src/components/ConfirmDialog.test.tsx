import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog, type ConfirmRequest } from './ConfirmDialog'

function renderDialog(overrides: Partial<ConfirmRequest> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  const request: ConfirmRequest = {
    title: 'Delete "Errands"?',
    message: 'Tasks will move to Inbox.',
    confirmLabel: 'Delete list',
    action: () => {},
    ...overrides,
  }
  render(<ConfirmDialog request={request} onConfirm={onConfirm} onCancel={onCancel} />)
  return { onConfirm, onCancel }
}

describe('ConfirmDialog', () => {
  it('shows the title and message and confirms on the action button', async () => {
    const user = userEvent.setup()
    const { onConfirm, onCancel } = renderDialog()

    expect(screen.getByRole('alertdialog', { name: 'Delete "Errands"?' })).toBeInTheDocument()
    expect(screen.getByText('Tasks will move to Inbox.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete list' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('cancels via the cancel button and via Escape', async () => {
    const user = userEvent.setup()
    const { onConfirm, onCancel } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('focuses Cancel first so Enter is safe by default', () => {
    renderDialog({ danger: true })
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })
})
