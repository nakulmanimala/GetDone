import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { AlignLeft, CheckSquare, Circle, X } from 'lucide-react'
import type { TaskDraft, TaskImage } from '../domain/tasks'
import { compressImageFile, findImageFile } from '../media/clipboardImage'
import { DetailsField } from './DetailsField'
import { DueControls, type DueValue } from './DueControls'

interface TaskComposerProps {
  project: string
  onCreate: (draft: TaskDraft) => void
  onClose: () => void
  now?: () => Date
}

const EMPTY_DUE: DueValue = {}

// Google Tasks composes in place: the "Add a task" row turns into the card
// itself, everything it can capture is on screen at once, and Enter files the
// task and leaves the card open for the next one.
export function TaskComposer({ project, onCreate, onClose, now = () => new Date() }: TaskComposerProps) {
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [due, setDue] = useState<DueValue>(EMPTY_DUE)
  const [images, setImages] = useState<TaskImage[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  // Everything typed so far, read through a ref so the outside-click handler
  // can save without being re-subscribed on every keystroke.
  const draftRef = useRef({ title, details, due, images })
  draftRef.current = { title, details, due, images }

  const submit = useCallback(() => {
    const { title: rawTitle, details: rawDetails, due: dueValue, images: attached } = draftRef.current
    const trimmed = rawTitle.trim()
    if (!trimmed) return false
    onCreate({
      title: trimmed,
      note: rawDetails.trim() || undefined,
      project,
      dueDate: dueValue.dueDate,
      dueTime: dueValue.dueTime,
      repeat: dueValue.repeat,
      images: attached,
    })
    return true
  }, [onCreate, project])

  const reset = () => {
    setTitle('')
    setDetails('')
    setDue(EMPTY_DUE)
    setImages([])
    titleRef.current?.focus()
  }

  // Clicking away commits whatever has been typed rather than discarding it,
  // which is what Google Tasks does — an accidental click never loses a task.
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Element
      if (rootRef.current?.contains(target)) return
      // The date and repeat popovers are portalled to the body but are still
      // part of the draft being composed.
      if (target.closest?.('.due-popover')) return
      submit()
      onClose()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [submit, onClose])

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    // Enter files the task from the title; details is multi-line, so there
    // only Cmd/Ctrl+Enter submits.
    const fromDetails = (event.target as HTMLElement).tagName === 'TEXTAREA'
    if (event.key === 'Enter' && (!fromDetails || event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (submit()) reset()
    }
  }

  function handlePaste(event: ClipboardEvent) {
    const file = findImageFile(event.clipboardData?.items)
    if (!file) return
    event.preventDefault()
    compressImageFile(file)
      .then((dataUrl) =>
        setImages((current) => [...current, { id: crypto.randomUUID(), dataUrl, addedAt: new Date().toISOString() }]),
      )
      .catch(() => {})
  }

  return (
    <div className="task-composer" ref={rootRef} onKeyDown={handleKeyDown} onPaste={handlePaste}>
      <div className="composer-head"><CheckSquare size={15} /> Add a task</div>

      <div className="composer-row">
        <Circle size={16} className="composer-icon" aria-hidden="true" />
        <input
          ref={titleRef}
          autoFocus
          className="composer-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title"
          aria-label="Task title"
        />
      </div>

      <div className="composer-row">
        <AlignLeft size={15} className="composer-icon" aria-hidden="true" />
        <DetailsField value={details} onChange={setDetails} ariaLabel="Task details" />
      </div>

      {images.length > 0 && (
        <div className="image-grid composer-images">
          {images.map((image) => (
            <div key={image.id} className="image-thumb">
              <img src={image.dataUrl} alt="" />
              <button
                type="button"
                className="image-remove"
                onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))}
                aria-label="Remove image"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <DueControls value={due} onChange={setDue} now={now} />
    </div>
  )
}
