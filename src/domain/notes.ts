// Details used to be a rich-text (HTML) field. They are plain text now, but
// tasks saved by earlier versions still hold HTML, so anything read out of a
// task goes through htmlToText first.

const BLOCK_END = /<\/(p|div|li|h[1-6]|tr)\s*>/gi
const LINE_BREAK = /<br\s*\/?>/gi

export function htmlToText(value: string): string {
  if (!/[<&]/.test(value)) return value
  const spaced = value.replace(LINE_BREAK, '\n').replace(BLOCK_END, '\n')
  const doc = new DOMParser().parseFromString(spaced, 'text/html')
  return (doc.body.textContent ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Single-line form for the collapsed row and for search matching. */
export function notePreview(note?: string): string {
  if (!note) return ''
  return htmlToText(note).replace(/\s+/g, ' ').trim()
}

/** Data URLs of images embedded in a legacy HTML note, so they can be kept. */
export function extractNoteImages(note: string): string[] {
  if (!note.includes('<img')) return []
  const doc = new DOMParser().parseFromString(note, 'text/html')
  return [...doc.body.querySelectorAll('img')]
    .map((image) => image.getAttribute('src') ?? '')
    .filter((src) => src.startsWith('data:image/'))
}
