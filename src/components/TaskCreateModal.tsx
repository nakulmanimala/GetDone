import { useEffect, useRef, useState, type ClipboardEvent, type MouseEvent } from 'react'
import {
  Bell,
  Bold,
  CalendarDays,
  ChevronDown,
  Flag,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Pencil,
  Repeat as RepeatIcon,
  Strikethrough,
  TriangleAlert,
  Underline,
  X,
} from 'lucide-react'
import type { Priority, Repeat, TaskDraft } from '../domain/tasks'
import { compressImageFile, findImageFile } from '../media/clipboardImage'
import { sanitizeHtml } from './richText'

type DueChoice = 'today' | 'tomorrow' | 'custom' | null
type ReminderChoice = '1h' | '4h' | 'custom' | null

const HOUR_MS = 3_600_000

const isoDate = (offsetDays = 0, now: () => Date = () => new Date()) =>
  new Date(now().getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10)

interface TaskCreateModalProps {
  initialTitle: string
  initialProject?: string
  projects: string[]
  onCancel: () => void
  onCreate: (draft: TaskDraft) => void
  now?: () => Date
}

export function TaskCreateModal({ initialTitle, initialProject, projects, onCancel, onCreate, now = () => new Date() }: TaskCreateModalProps) {
  const [title, setTitle] = useState(initialTitle)
  const [titleMissing, setTitleMissing] = useState(false)
  const [project, setProject] = useState(initialProject ?? projects[0] ?? 'Inbox')
  const [dueChoice, setDueChoice] = useState<DueChoice>(null)
  const [customDue, setCustomDue] = useState('')
  const [repeat, setRepeat] = useState<'none' | Repeat>('none')
  const [repeatOpen, setRepeatOpen] = useState(false)
  const [reminderChoice, setReminderChoice] = useState<ReminderChoice>(null)
  const [customReminder, setCustomReminder] = useState('')
  const [priority, setPriority] = useState<Priority>('none')
  const [flagged, setFlagged] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const editorRef = useRef<HTMLDivElement>(null)
  const savedRangeRef = useRef<Range | null>(null)

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onCancel])

  // Keep the text selection in the editor alive while clicking toolbar buttons.
  const keepSelection = (event: MouseEvent) => event.preventDefault()

  function exec(command: string, value?: string) {
    editorRef.current?.focus()
    document.execCommand(command, false, value)
  }

  function openLinkPopover() {
    // The URL input will steal focus, so remember what was selected in the
    // editor to re-apply it when the link is inserted.
    const selection = window.getSelection()
    savedRangeRef.current =
      selection && selection.rangeCount > 0 && editorRef.current?.contains(selection.getRangeAt(0).commonAncestorContainer)
        ? selection.getRangeAt(0).cloneRange()
        : null
    setLinkUrl('')
    setLinkOpen(true)
  }

  function applyLink() {
    const raw = linkUrl.trim()
    setLinkOpen(false)
    if (!raw) return
    const url = /^(https?:\/\/|mailto:)/i.test(raw) ? raw : `https://${raw}`
    editorRef.current?.focus()
    const selection = window.getSelection()
    if (savedRangeRef.current && selection) {
      selection.removeAllRanges()
      selection.addRange(savedRangeRef.current)
    }
    if (savedRangeRef.current && !savedRangeRef.current.collapsed) {
      document.execCommand('createLink', false, url)
    } else {
      const escaped = url.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      document.execCommand('insertHTML', false, `<a href="${escaped}">${escaped}</a>`)
    }
  }

  function handleDescriptionPaste(event: ClipboardEvent<HTMLDivElement>) {
    const file = findImageFile(event.clipboardData?.items)
    if (!file) return
    // Never let the browser insert the raw image: a heavy paste would render
    // at natural size (bursting the dialog) and be stored uncompressed.
    // stopPropagation keeps the app-level paste listener from also attaching
    // it to whichever task is selected behind the dialog.
    event.preventDefault()
    event.stopPropagation()
    compressImageFile(file)
      .then((dataUrl) => {
        editorRef.current?.focus()
        document.execCommand('insertImage', false, dataUrl)
      })
      .catch(() => {})
  }

  function handleCreate() {
    const trimmed = title.trim()
    if (!trimmed) {
      setTitleMissing(true)
      return
    }

    const hasNote = Boolean(editorRef.current?.textContent?.trim()) || Boolean(editorRef.current?.querySelector('img'))
    onCreate({
      title: trimmed,
      note: hasNote ? sanitizeHtml(editorRef.current?.innerHTML ?? '') : undefined,
      project,
      priority,
      dueDate:
        dueChoice === 'today'
          ? isoDate(0, now)
          : dueChoice === 'tomorrow'
            ? isoDate(1, now)
            : dueChoice === 'custom' && customDue
              ? customDue
              : undefined,
      reminderAt:
        reminderChoice === '1h'
          ? new Date(now().getTime() + HOUR_MS).toISOString()
          : reminderChoice === '4h'
            ? new Date(now().getTime() + 4 * HOUR_MS).toISOString()
            : reminderChoice === 'custom' && customReminder
              ? new Date(customReminder).toISOString()
              : undefined,
      repeat: repeat === 'none' ? undefined : repeat,
      flagged,
    })
  }

  const dueChip = (choice: Exclude<DueChoice, null>) => `chip ${dueChoice === choice ? 'chip-active' : ''}`
  const reminderChip = (choice: Exclude<ReminderChoice, null>) => `chip ${reminderChoice === choice ? 'chip-active' : ''}`
  const toggleDue = (choice: Exclude<DueChoice, null>) => setDueChoice((current) => (current === choice ? null : choice))
  const toggleReminder = (choice: Exclude<ReminderChoice, null>) =>
    setReminderChoice((current) => (current === choice ? null : choice))

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="task-modal" role="dialog" aria-modal="true" aria-label="Create task" onClick={(event) => event.stopPropagation()}>
        <div className="modal-list-picker">
          <ListTodo size={14} />
          <select value={project} onChange={(event) => setProject(event.target.value)} aria-label="Project">
            {projects.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <ChevronDown size={13} />
        </div>

        <div className="modal-title-row">
          <span className="title-circle" aria-hidden="true" />
          <input
            autoFocus
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
              if (event.target.value.trim()) setTitleMissing(false)
            }}
            placeholder="Enter task"
            aria-label="Task title"
          />
        </div>
        {titleMissing && <p className="field-error">This field is required</p>}

        <div className="modal-row">
          <div className="modal-row-label"><Pencil size={15} /><span>Description</span></div>
          <div className="rich-editor">
            <div className="rich-toolbar" role="toolbar" aria-label="Text formatting">
              <button type="button" onMouseDown={keepSelection} onClick={() => exec('bold')} aria-label="Bold"><Bold size={14} /></button>
              <button type="button" onMouseDown={keepSelection} onClick={() => exec('italic')} aria-label="Italic"><Italic size={14} /></button>
              <button type="button" onMouseDown={keepSelection} onClick={() => exec('underline')} aria-label="Underline"><Underline size={14} /></button>
              <button type="button" onMouseDown={keepSelection} onClick={() => exec('strikeThrough')} aria-label="Strikethrough"><Strikethrough size={14} /></button>
              <span className="toolbar-divider" />
              <select
                className="font-size-select"
                aria-label="Text size"
                value=""
                onMouseDown={(event) => event.stopPropagation()}
                onChange={(event) => {
                  if (event.target.value) exec('fontSize', event.target.value)
                }}
              >
                <option value="" disabled hidden>Aa</option>
                <option value="2">Small</option>
                <option value="3">Normal</option>
                <option value="5">Large</option>
              </select>
              <span className="toolbar-divider" />
              <button type="button" onMouseDown={keepSelection} onClick={() => exec('insertUnorderedList')} aria-label="Bulleted list"><List size={14} /></button>
              <button type="button" onMouseDown={keepSelection} onClick={() => exec('insertOrderedList')} aria-label="Numbered list"><ListOrdered size={14} /></button>
              <span className="toolbar-divider" />
              <button type="button" onMouseDown={keepSelection} onClick={openLinkPopover} aria-label="Insert link"><Link2 size={14} /></button>
            </div>
            {linkOpen && (
              <div className="link-popover">
                <Link2 size={14} />
                <input
                  autoFocus
                  value={linkUrl}
                  onChange={(event) => setLinkUrl(event.target.value)}
                  onKeyDown={(event) => {
                    // Keep Escape/Enter local: the modal itself closes on Escape.
                    event.stopPropagation()
                    if (event.key === 'Enter') { event.preventDefault(); applyLink() }
                    if (event.key === 'Escape') setLinkOpen(false)
                  }}
                  placeholder="Paste or type a link"
                  aria-label="Link URL"
                />
                <button type="button" className="link-apply" onClick={applyLink}>Add link</button>
                <button type="button" className="link-close" onClick={() => setLinkOpen(false)} aria-label="Close link editor"><X size={14} /></button>
              </div>
            )}
            <div
              ref={editorRef}
              className="rich-input"
              contentEditable
              role="textbox"
              aria-multiline="true"
              aria-label="Task description"
              data-placeholder="What is this task about?"
              onPaste={handleDescriptionPaste}
            />
          </div>
        </div>

        <div className="modal-row">
          <div className="modal-row-label"><CalendarDays size={15} /><span>Due date</span></div>
          <div className="chip-group">
            <button type="button" className={dueChip('today')} onClick={() => toggleDue('today')}>Today</button>
            <button type="button" className={dueChip('tomorrow')} onClick={() => toggleDue('tomorrow')}>Tomorrow</button>
            <button type="button" className={dueChip('custom')} onClick={() => toggleDue('custom')}><Pencil size={12} /> Custom</button>
            <button
              type="button"
              className={`chip ${repeat !== 'none' ? 'chip-active' : ''}`}
              aria-expanded={repeatOpen}
              onClick={() => setRepeatOpen((open) => !open)}
            >
              <RepeatIcon size={12} /> Repeat
            </button>
            {dueChoice === 'custom' && (
              <input type="date" className="chip-input" value={customDue} onChange={(event) => setCustomDue(event.target.value)} aria-label="Custom due date" />
            )}
            {repeatOpen && (
              <select className="chip-input" value={repeat} onChange={(event) => setRepeat(event.target.value as 'none' | Repeat)} aria-label="Repeat schedule">
                <option value="none">Doesn't repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            )}
          </div>
        </div>

        <div className="modal-row">
          <div className="modal-row-label"><Bell size={15} /><span>Reminder</span></div>
          <div className="chip-group">
            <button type="button" className={reminderChip('1h')} onClick={() => toggleReminder('1h')}>In 1 hour</button>
            <button type="button" className={reminderChip('4h')} onClick={() => toggleReminder('4h')}>In 4 hours</button>
            <button type="button" className={reminderChip('custom')} onClick={() => toggleReminder('custom')}><Pencil size={12} /> Custom</button>
            {reminderChoice === 'custom' && (
              <input
                type="datetime-local"
                className="chip-input"
                value={customReminder}
                onChange={(event) => setCustomReminder(event.target.value)}
                aria-label="Custom reminder time"
              />
            )}
          </div>
        </div>

        <div className="modal-row">
          <div className="modal-row-label"><TriangleAlert size={15} /><span>Priority</span></div>
          <div className="chip-group">
            {(['low', 'medium', 'high'] as const).map((level) => (
              <button
                type="button"
                key={level}
                className={`chip chip-${level} ${priority === level ? 'chip-active' : ''}`}
                onClick={() => setPriority((current) => (current === level ? 'none' : level))}
              >
                {level[0].toUpperCase() + level.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-row">
          <div className="modal-row-label"><Flag size={15} /><span>Flag</span></div>
          <button
            type="button"
            role="switch"
            aria-checked={flagged}
            aria-label="Flag task"
            className={`switch ${flagged ? 'switch-on' : ''}`}
            onClick={() => setFlagged((value) => !value)}
          >
            <i />
          </button>
        </div>

        <div className="modal-footer">
          <button type="button" className="modal-cancel" onClick={onCancel}>Cancel</button>
          <button type="button" className="modal-create" onClick={handleCreate}>Create task</button>
        </div>
      </div>
    </div>
  )
}
