import { describe, expect, it } from 'vitest'
import { validatePayload } from './validate'

const validPayload = {
  updatedAt: '2026-08-14T00:00:00.000Z',
  tasks: [{ id: '1', title: 'Buy milk' }],
}

describe('validatePayload', () => {
  it('accepts a well-formed payload', () => {
    expect(validatePayload(validPayload)).toEqual(validPayload)
  })

  it('rejects a non-object', () => {
    expect(() => validatePayload('nope')).toThrow()
    expect(() => validatePayload(null)).toThrow()
  })

  it('rejects a missing updatedAt', () => {
    const { updatedAt: _omitted, ...rest } = validPayload
    expect(() => validatePayload(rest)).toThrow()
  })

  it('rejects a non-ISO updatedAt', () => {
    expect(() => validatePayload({ ...validPayload, updatedAt: 'not-a-date' })).toThrow()
  })

  it('rejects a missing tasks field', () => {
    const { tasks: _omitted, ...rest } = validPayload
    expect(() => validatePayload(rest)).toThrow()
  })

  it('accepts an empty tasks array', () => {
    expect(validatePayload({ updatedAt: validPayload.updatedAt, tasks: [] })).toEqual({
      updatedAt: validPayload.updatedAt,
      tasks: [],
    })
  })
})
