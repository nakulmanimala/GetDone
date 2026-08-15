import { describe, expect, it } from 'vitest'
import { formatDue, isOverdue, isoDate } from './dueDate'

// Local noon, so the assertions never depend on the runner's UTC offset.
const at = (iso: string) => () => new Date(iso)
const friday = at('2026-08-21T12:00:00')

describe('due dates', () => {
  it('offsets from today in local calendar days', () => {
    expect(isoDate(0, friday)).toBe('2026-08-21')
    expect(isoDate(1, friday)).toBe('2026-08-22')
  })

  it('does not mutate the clock it is given', () => {
    const date = new Date('2026-08-21T12:00:00')
    isoDate(5, () => date)
    expect(date.getDate()).toBe(21)
  })

  it('rolls over month boundaries', () => {
    expect(isoDate(1, at('2026-08-31T12:00:00'))).toBe('2026-09-01')
  })

  it('labels today and tomorrow by name and everything else by date', () => {
    expect(formatDue('2026-08-21', undefined, friday)).toBe('Today')
    expect(formatDue('2026-08-22', undefined, friday)).toBe('Tomorrow')
    expect(formatDue('2026-08-28', undefined, friday)).toBe('Fri, Aug 28')
  })

  it('appends the time of day when one is set', () => {
    expect(formatDue('2026-08-28', '09:00', friday)).toBe('Fri, Aug 28, 9:00 AM')
    expect(formatDue('2026-08-21', '17:30', friday)).toBe('Today, 5:30 PM')
  })

  it('has no label without a date', () => {
    expect(formatDue(undefined, '09:00', friday)).toBe('')
  })

  it('treats a dateless task and the rest of today as not overdue', () => {
    expect(isOverdue(undefined, undefined, friday)).toBe(false)
    expect(isOverdue('2026-08-21', undefined, friday)).toBe(false)
  })

  it('is overdue once the day, or the time within today, has passed', () => {
    expect(isOverdue('2026-08-20', undefined, friday)).toBe(true)
    expect(isOverdue('2026-08-21', '09:00', friday)).toBe(true)
    expect(isOverdue('2026-08-21', '18:00', friday)).toBe(false)
  })
})
