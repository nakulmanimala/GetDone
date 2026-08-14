import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskCreateModal } from './TaskCreateModal'
import { sanitizeHtml, stripHtml } from './richText'

vi.mock('../media/clipboardImage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../media/clipboardImage')>()),
  // jsdom has no canvas, so the real compressor cannot run in tests.
  compressImageFile: vi.fn(() => Promise.resolve('data:image/jpeg;base64,compressed')),
}))

const projects = ['Inbox', 'Personal']
const fixedNow = () => new Date('2026-08-14T10:00:00.000Z')

function renderModal(overrides: Partial<Parameters<typeof TaskCreateModal>[0]> = {}) {
  const onCreate = vi.fn()
  const onCancel = vi.fn()
  render(
    <TaskCreateModal
      initialTitle=""
      projects={projects}
      onCancel={onCancel}
      onCreate={onCreate}
      now={fixedNow}
      {...overrides}
    />,
  )
  return { onCreate, onCancel }
}

describe('TaskCreateModal', () => {
  it('shows a required-field error instead of creating when the title is empty', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderModal()

    await user.click(screen.getByRole('button', { name: 'Create task' }))

    expect(screen.getByText('This field is required')).toBeInTheDocument()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('clears the error once a title is typed', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('button', { name: 'Create task' }))
    await user.type(screen.getByLabelText('Task title'), 'Water plants')

    expect(screen.queryByText('This field is required')).not.toBeInTheDocument()
  })

  it('creates a task with due date, reminder, priority, and flag', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderModal({ initialTitle: 'Ship it' })

    await user.click(screen.getByRole('button', { name: 'Tomorrow' }))
    await user.click(screen.getByRole('button', { name: 'In 1 hour' }))
    await user.click(screen.getByRole('button', { name: 'High' }))
    await user.click(screen.getByRole('switch', { name: 'Flag task' }))
    await user.click(screen.getByRole('button', { name: 'Create task' }))

    expect(onCreate).toHaveBeenCalledWith({
      title: 'Ship it',
      note: undefined,
      project: 'Inbox',
      priority: 'high',
      dueDate: '2026-08-15',
      reminderAt: '2026-08-14T11:00:00.000Z',
      repeat: undefined,
      flagged: true,
    })
  })

  it('toggles a chip off when clicked again', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderModal({ initialTitle: 'Ship it' })

    await user.click(screen.getByRole('button', { name: 'Today' }))
    await user.click(screen.getByRole('button', { name: 'Today' }))
    await user.click(screen.getByRole('button', { name: 'Create task' }))

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ dueDate: undefined }))
  })

  it('accepts a custom due date and a repeat schedule', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderModal({ initialTitle: 'Renew domain' })

    // Two "Custom" chips exist (due date and reminder); the first is due date.
    await user.click(screen.getAllByRole('button', { name: 'Custom' })[0])
    await user.type(screen.getByLabelText('Custom due date'), '2026-09-01')
    await user.click(screen.getByRole('button', { name: 'Repeat' }))
    await user.selectOptions(screen.getByLabelText('Repeat schedule'), 'monthly')
    await user.click(screen.getByRole('button', { name: 'Create task' }))

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ dueDate: '2026-09-01', repeat: 'monthly' }))
  })

  it('cancels on Escape', async () => {
    const user = userEvent.setup()
    const { onCancel, onCreate } = renderModal()

    await user.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalled()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('compresses a pasted image instead of inserting it raw', async () => {
    renderModal({ initialTitle: 'Ship it' })
    const editor = screen.getByLabelText('Task description')
    const execCommand = vi.fn()
    document.execCommand = execCommand

    const file = new File(['raw-bytes'], 'shot.png', { type: 'image/png' })
    const paste = fireEvent.paste(editor, {
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] },
    })

    expect(paste).toBe(false) // default insertion of the raw image was prevented
    await waitFor(() => expect(execCommand).toHaveBeenCalledWith('insertImage', false, 'data:image/jpeg;base64,compressed'))
  })

  it('keeps an image-only description instead of dropping it', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderModal({ initialTitle: 'Ship it' })

    const editor = screen.getByLabelText('Task description')
    editor.innerHTML = '<img src="data:image/jpeg;base64,compressed">'
    await user.click(screen.getByRole('button', { name: 'Create task' }))

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ note: '<img src="data:image/jpeg;base64,compressed">' }))
  })

  it('includes the typed description as sanitized HTML', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderModal({ initialTitle: 'Ship it' })

    const editor = screen.getByLabelText('Task description')
    await user.click(editor)
    await user.keyboard('Details here')
    await user.click(screen.getByRole('button', { name: 'Create task' }))

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ note: 'Details here' }))
  })
})

describe('rich text helpers', () => {
  it('sanitizeHtml strips scripts and event handlers but keeps formatting', () => {
    expect(sanitizeHtml('<b>bold</b><script>alert(1)</script><i onclick="x()">i</i>')).toBe('<b>bold</b><i>i</i>')
  })

  it('sanitizeHtml removes javascript: links', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>')
  })

  it('stripHtml flattens markup for search', () => {
    expect(stripHtml('<b>milk</b> and <i>eggs</i>').replace(/\s+/g, ' ').trim()).toBe('milk and eggs')
  })
})
