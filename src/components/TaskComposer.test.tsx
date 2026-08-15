import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskComposer } from './TaskComposer'

vi.mock('../media/clipboardImage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../media/clipboardImage')>()),
  // jsdom has no canvas, so the real compressor cannot run in tests.
  compressImageFile: vi.fn(() => Promise.resolve('data:image/jpeg;base64,compressed')),
}))

const fixedNow = () => new Date('2026-08-14T10:00:00')

function renderComposer(overrides: Partial<Parameters<typeof TaskComposer>[0]> = {}) {
  const onCreate = vi.fn()
  const onClose = vi.fn()
  render(<TaskComposer project="Personal" onCreate={onCreate} onClose={onClose} now={fixedNow} {...overrides} />)
  return { onCreate, onClose }
}

describe('TaskComposer', () => {
  it('creates a task from the title alone, into the column it belongs to', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderComposer()

    await user.type(screen.getByLabelText('Task title'), 'Water plants{Enter}')

    expect(onCreate).toHaveBeenCalledWith({
      title: 'Water plants',
      note: undefined,
      project: 'Personal',
      dueDate: undefined,
      dueTime: undefined,
      repeat: undefined,
      images: [],
    })
  })

  it('stays open and clears itself so the next task can be typed', async () => {
    const user = userEvent.setup()
    const { onCreate, onClose } = renderComposer()
    const title = screen.getByLabelText('Task title')

    await user.type(title, 'First{Enter}')
    await user.type(title, 'Second{Enter}')

    expect(onCreate).toHaveBeenCalledTimes(2)
    expect(onCreate.mock.calls[1][0]).toMatchObject({ title: 'Second' })
    expect(title).toHaveValue('')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ignores Enter while the title is empty', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderComposer()

    await user.type(screen.getByLabelText('Task title'), '   {Enter}')

    expect(onCreate).not.toHaveBeenCalled()
  })

  it('keeps details as plain multi-line text, submitting only on Cmd+Enter', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderComposer()

    await user.type(screen.getByLabelText('Task title'), 'Ship it')
    await user.type(screen.getByLabelText('Task details'), 'Line one{Enter}Line two')
    expect(onCreate).not.toHaveBeenCalled()

    await user.keyboard('{Meta>}{Enter}{/Meta}')

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ note: 'Line one\nLine two' }))
  })

  it('sets a due date from the Today and Tomorrow chips', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderComposer()

    await user.type(screen.getByLabelText('Task title'), 'Ship it')
    await user.click(screen.getByRole('button', { name: 'Tomorrow' }))
    // Enter goes through the title: picking a date unmounts the chip that
    // was just clicked, so nothing inside the composer holds focus.
    await user.type(screen.getByLabelText('Task title'), '{Enter}')

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ dueDate: '2026-08-15' }))
  })

  it('shows the chosen date as one clearable chip', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderComposer()

    await user.type(screen.getByLabelText('Task title'), 'Ship it')
    await user.click(screen.getByRole('button', { name: 'Today' }))
    expect(screen.queryByRole('button', { name: 'Tomorrow' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove due date' }))
    await user.type(screen.getByLabelText('Task title'), '{Enter}')

    expect(screen.getByRole('button', { name: 'Tomorrow' })).toBeInTheDocument()
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ dueDate: undefined }))
  })

  it('adds a time of day through the date picker', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderComposer()

    await user.type(screen.getByLabelText('Task title'), 'Standup')
    await user.click(screen.getByRole('button', { name: 'Pick a date and time' }))
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('Due time'), { target: { value: '09:00' } })
    await user.click(screen.getByRole('button', { name: 'Done' }))

    await user.type(screen.getByLabelText('Task title'), '{Enter}')

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ dueDate: '2026-09-01', dueTime: '09:00' }))
  })

  it('picks a repeat schedule from the repeat menu', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderComposer()

    await user.type(screen.getByLabelText('Task title'), 'Renew domain')
    await user.click(screen.getByRole('button', { name: 'Repeat' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Monthly' }))
    await user.type(screen.getByLabelText('Task title'), '{Enter}')

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ repeat: 'monthly' }))
  })

  it('attaches a pasted image as a compressed thumbnail', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderComposer()

    await user.type(screen.getByLabelText('Task title'), 'Bug report')
    const file = new File(['raw-bytes'], 'shot.png', { type: 'image/png' })
    fireEvent.paste(screen.getByLabelText('Task details'), {
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] },
    })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove image' })).toBeInTheDocument())
    await user.type(screen.getByLabelText('Task title'), '{Enter}')

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [expect.objectContaining({ dataUrl: 'data:image/jpeg;base64,compressed' })],
      }),
    )
  })

  it('discards the draft on Escape', async () => {
    const user = userEvent.setup()
    const { onCreate, onClose } = renderComposer()

    await user.type(screen.getByLabelText('Task title'), 'Never mind')
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('saves rather than loses the draft when clicking away', async () => {
    const user = userEvent.setup()
    const { onCreate, onClose } = renderComposer()

    await user.type(screen.getByLabelText('Task title'), 'Half typed')
    await user.click(document.body)

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ title: 'Half typed' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes without creating anything when clicking away from an empty composer', async () => {
    const user = userEvent.setup()
    const { onCreate, onClose } = renderComposer()

    await user.click(document.body)

    expect(onCreate).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
