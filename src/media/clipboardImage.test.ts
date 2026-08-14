import { describe, expect, it } from 'vitest'
import { findImageFile, type ClipboardItemLike } from './clipboardImage'

function fakeFile(): File {
  return new File(['fake'], 'pasted.png', { type: 'image/png' })
}

describe('findImageFile', () => {
  it('returns the file from the first image item', () => {
    const file = fakeFile()
    const items: ClipboardItemLike[] = [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'image/png', getAsFile: () => file },
    ]

    expect(findImageFile(items)).toBe(file)
  })

  it('ignores non-image file items', () => {
    const items: ClipboardItemLike[] = [
      { kind: 'file', type: 'text/csv', getAsFile: () => new File(['a,b'], 'data.csv', { type: 'text/csv' }) },
    ]

    expect(findImageFile(items)).toBeNull()
  })

  it('returns null for empty items', () => {
    expect(findImageFile([])).toBeNull()
  })

  it('returns null for null/undefined input', () => {
    expect(findImageFile(null)).toBeNull()
    expect(findImageFile(undefined)).toBeNull()
  })

  it('picks the first image item when multiple are present', () => {
    const first = fakeFile()
    const second = fakeFile()
    const items: ClipboardItemLike[] = [
      { kind: 'file', type: 'image/png', getAsFile: () => first },
      { kind: 'file', type: 'image/jpeg', getAsFile: () => second },
    ]

    expect(findImageFile(items)).toBe(first)
  })
})
