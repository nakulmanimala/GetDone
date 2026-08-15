// Google Tasks models a due date as a calendar day plus an optional time of
// day, and labels it relative to today. Dates are handled as local wall-clock
// `YYYY-MM-DD` strings so a task due "today" stays due today regardless of the
// user's UTC offset.

const dayFormat = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' })
const timeFormat = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' })

const pad = (value: number) => String(value).padStart(2, '0')

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The local calendar day `offsetDays` from now, as `YYYY-MM-DD`. */
export function isoDate(offsetDays = 0, now: () => Date = () => new Date()): string {
  const date = new Date(now()) // copy: never mutate the caller's clock
  date.setDate(date.getDate() + offsetDays)
  return toIsoDate(date)
}

/** Parses `YYYY-MM-DD` (+ optional `HH:MM`) as a local date, never UTC. */
function parseLocal(date: string, time?: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  const [hour = 0, minute = 0] = time?.split(':').map(Number) ?? []
  return new Date(year, month - 1, day, hour, minute)
}

/** "Today", "Tomorrow, 9:00 AM", "Fri, Aug 21" — the chip label. */
export function formatDue(date?: string, time?: string, now: () => Date = () => new Date()): string {
  if (!date) return ''
  const parsed = parseLocal(date, time)
  if (Number.isNaN(parsed.getTime())) return date

  const today = isoDate(0, now)
  const day = date === today ? 'Today' : date === isoDate(1, now) ? 'Tomorrow' : dayFormat.format(parsed)
  return time ? `${day}, ${timeFormat.format(parsed)}` : day
}

/** True once the due moment has passed, so the chip can be shown as overdue. */
export function isOverdue(date?: string, time?: string, now: () => Date = () => new Date()): boolean {
  if (!date) return false
  const current = now()
  // A date without a time is only late once the whole day is behind us.
  return time ? parseLocal(date, time) < current : date < isoDate(0, () => current)
}
