import { useLayoutEffect, useRef } from 'react'

interface DetailsFieldProps {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  placeholder?: string
}

// A plain-text notes field that grows with its content, so the card stays as
// short as the task deserves instead of reserving a fixed box.
export function DetailsField({ value, onChange, ariaLabel, placeholder = 'Details' }: DetailsFieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      rows={1}
      className="details-field"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
    />
  )
}
