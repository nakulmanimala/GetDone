import { describe, expect, it } from 'vitest'
import { extractNoteImages, htmlToText, notePreview } from './notes'

describe('notes', () => {
  it('returns plain text unchanged', () => {
    expect(htmlToText('Buy milk')).toBe('Buy milk')
  })

  it('turns block tags and breaks into newlines', () => {
    expect(htmlToText('<div>One</div><div>Two</div>')).toBe('One\nTwo')
    expect(htmlToText('One<br>Two')).toBe('One\nTwo')
    expect(htmlToText('<ul><li>One</li><li>Two</li></ul>')).toBe('One\nTwo')
  })

  it('drops inline markup but keeps its text', () => {
    expect(htmlToText('<b>milk</b> and <i>eggs</i>')).toBe('milk and eggs')
  })

  it('decodes entities', () => {
    expect(htmlToText('Tom &amp; Jerry')).toBe('Tom & Jerry')
  })

  it('never leaves executable markup behind', () => {
    expect(htmlToText('<script>alert(1)</script>ok')).not.toContain('<')
  })

  it('collapses a note to one line for the collapsed row', () => {
    expect(notePreview('<p>One</p><p>Two</p>')).toBe('One Two')
    expect(notePreview(undefined)).toBe('')
  })

  it('pulls embedded data-URL images out of a legacy note', () => {
    expect(extractNoteImages('a<img src="data:image/jpeg;base64,xyz">b')).toEqual(['data:image/jpeg;base64,xyz'])
  })

  it('ignores remote and missing image sources', () => {
    expect(extractNoteImages('<img src="https://example.com/a.png"><img>')).toEqual([])
    expect(extractNoteImages('no images here')).toEqual([])
  })
})
