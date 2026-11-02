import { useEffect, useRef } from 'react'

/* A name typed in place (a new node, a new branch, a rename). Return keeps it; Esc or an
   empty name leaves things as they were. */
export function NameField({ initial = '', placeholder, onDone, className = '' }) {
  const field = useRef(null)
  const settled = useRef(false)
  useEffect(() => { field.current?.focus(); field.current?.select() }, [])
  const finish = (keep) => {
    if (settled.current) return
    settled.current = true
    const value = field.current.value.trim()
    onDone(keep && value && value !== initial ? value : null)
  }
  return (
    <input
      ref={field}
      className={`name-field ${className}`}
      defaultValue={initial}
      placeholder={placeholder}
      aria-label={placeholder}
      maxLength={80}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); finish(true) }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false) }
      }}
    />
  )
}
