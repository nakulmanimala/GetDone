import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Clock, Repeat as RepeatIcon, X } from 'lucide-react'
import { formatDue, isOverdue, isoDate } from '../domain/dueDate'
import type { Repeat } from '../domain/tasks'

export interface DueValue {
  dueDate?: string
  dueTime?: string
  repeat?: Repeat
}

interface DueControlsProps {
  value: DueValue
  onChange: (next: DueValue) => void
  now?: () => Date
}

const REPEAT_OPTIONS: { value: Repeat | 'none'; label: string }[] = [
  { value: 'none', label: "Doesn't repeat" },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

const GAP = 6
const EDGE = 8

// The single row of date/repeat affordances Google Tasks shows under the
// details field, shared by the inline composer and the expanded task so both
// behave identically: quick Today/Tomorrow chips until a date exists, then one
// chip that shows the date and clears it.
export function DueControls({ value, onChange, now = () => new Date() }: DueControlsProps) {
  const [openMenu, setOpenMenu] = useState<'date' | 'repeat' | null>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Popovers are portalled to the body and positioned by hand: an expanded
  // task sits inside a short scrolling column that would otherwise clip them,
  // whichever way they opened. Measured after mount, then flipped above the
  // row when there is no room below.
  useLayoutEffect(() => {
    if (!openMenu) {
      setPosition(null)
      return
    }
    const anchor = rootRef.current?.getBoundingClientRect()
    const popover = popoverRef.current?.getBoundingClientRect()
    if (!anchor || !popover) return

    const below = anchor.bottom + GAP
    const above = anchor.top - GAP - popover.height
    const top = below + popover.height > window.innerHeight - EDGE && above > EDGE ? above : below
    // The repeat menu hangs off the right-aligned toggle, the date picker off
    // the left; both are then pulled back inside the viewport.
    const preferred = openMenu === 'repeat' ? anchor.right - popover.width : anchor.left
    const left = Math.max(EDGE, Math.min(preferred, window.innerWidth - popover.width - EDGE))
    setPosition({ top, left })
  }, [openMenu])

  useEffect(() => {
    if (!openMenu) return
    const close = () => setOpenMenu(null)
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      close()
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      // The composer and the expanded card also close on Escape; this popover
      // is the innermost layer, so it consumes the key.
      event.stopPropagation()
      close()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKey, true)
    // A fixed popover cannot follow its anchor, so dismiss instead of drifting.
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKey, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [openMenu])

  const setDue = (dueDate?: string, dueTime?: string) =>
    onChange({ ...value, dueDate, dueTime: dueDate ? dueTime : undefined })

  const toggleMenu = (menu: 'date' | 'repeat') => setOpenMenu((open) => (open === menu ? null : menu))

  const overdue = isOverdue(value.dueDate, value.dueTime, now)

  // Hidden until measured, so it never flashes at the wrong spot.
  const popoverStyle = { top: position?.top ?? 0, left: position?.left ?? 0, visibility: position ? 'visible' : 'hidden' } as const

  return (
    <div className="due-controls" ref={rootRef}>
      {value.dueDate ? (
        <span className={`due-chip due-chip-set ${overdue ? 'overdue' : ''}`}>
          <button
            type="button"
            className="due-chip-label"
            onClick={() => toggleMenu('date')}
            aria-label={`Due ${formatDue(value.dueDate, value.dueTime, now)}. Change date`}
          >
            <Clock size={12} />
            {formatDue(value.dueDate, value.dueTime, now)}
          </button>
          <button type="button" className="due-chip-clear" onClick={() => setDue(undefined)} aria-label="Remove due date">
            <X size={12} />
          </button>
        </span>
      ) : (
        <>
          <button type="button" className="chip" onClick={() => setDue(isoDate(0, now))}>Today</button>
          <button type="button" className="chip" onClick={() => setDue(isoDate(1, now))}>Tomorrow</button>
          <button
            type="button"
            className="chip chip-icon"
            aria-label="Pick a date and time"
            aria-expanded={openMenu === 'date'}
            onClick={() => toggleMenu('date')}
          >
            <Clock size={14} />
          </button>
        </>
      )}

      <button
        type="button"
        className={`chip chip-icon repeat-toggle ${value.repeat ? 'chip-active' : ''}`}
        aria-label={value.repeat ? `Repeats ${value.repeat}. Change` : 'Repeat'}
        aria-expanded={openMenu === 'repeat'}
        onClick={() => toggleMenu('repeat')}
      >
        <RepeatIcon size={14} />
      </button>

      {openMenu === 'date' && createPortal(
        <div className="due-popover" ref={popoverRef} style={popoverStyle}>
          <label>Date
            <input
              type="date"
              autoFocus
              value={value.dueDate ?? ''}
              onChange={(event) => setDue(event.target.value || undefined, value.dueTime)}
              aria-label="Due date"
            />
          </label>
          <label>Time
            <input
              type="time"
              value={value.dueTime ?? ''}
              disabled={!value.dueDate}
              onChange={(event) => setDue(value.dueDate, event.target.value || undefined)}
              aria-label="Due time"
            />
          </label>
          <button type="button" className="due-popover-done" onClick={() => setOpenMenu(null)}>Done</button>
        </div>,
        document.body,
      )}

      {openMenu === 'repeat' && createPortal(
        <div className="due-popover repeat-popover" ref={popoverRef} style={popoverStyle} role="menu" aria-label="Repeat schedule">
          {REPEAT_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.value}
              role="menuitemradio"
              aria-checked={(value.repeat ?? 'none') === option.value}
              className={(value.repeat ?? 'none') === option.value ? 'selected' : ''}
              onClick={() => {
                onChange({ ...value, repeat: option.value === 'none' ? undefined : option.value })
                setOpenMenu(null)
              }}
            >
              {option.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
