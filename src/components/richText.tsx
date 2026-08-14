import { useEffect, useRef } from 'react'

// Notes are stored as a small HTML fragment produced by contentEditable.
// Pasted content can carry scripts or event handlers, so everything is
// sanitized before it reaches storage.
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.body.querySelectorAll('script, style, iframe, object, embed, form').forEach((node) => node.remove())
  doc.body.querySelectorAll('*').forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim().toLowerCase()
      if (name.startsWith('on') || ((name === 'href' || name === 'src') && value.startsWith('javascript:'))) {
        element.removeAttribute(attribute.name)
      }
    }
  })
  return doc.body.innerHTML
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ')
}

interface RichNoteEditorProps {
  initialHtml: string
  placeholder: string
  ariaLabel: string
  className?: string
  onChange: (html: string) => void
}

// Uncontrolled contentEditable: the DOM owns the content while typing so the
// caret never jumps; the parent remounts it (via key) when the task changes.
export function RichNoteEditor({ initialHtml, placeholder, ariaLabel, className, onChange }: RichNoteEditorProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initialHtml
    // eslint-disable-next-line react-hooks/exhaustive-deps -- set only on mount
  }, [])

  return (
    <div
      ref={ref}
      className={className ?? 'note-editor rich-note'}
      contentEditable
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel}
      data-placeholder={placeholder}
      onInput={() => onChange(sanitizeHtml(ref.current?.innerHTML ?? ''))}
    />
  )
}
