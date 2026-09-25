import { useEffect, useState } from 'react'

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return reduced
}

export function FieldBanner({ preview, sampled, onKeep, onBlank, onRemove }) {
  if (preview) {
    return (
      <div className="field-banner" role="status">
        <p>A sample room, so you can see the shape of it. Nothing is saved yet.</p>
        <button type="button" className="primary-button" onClick={onKeep}>Keep this room</button>
        <button type="button" onClick={onBlank}>Start blank</button>
      </div>
    )
  }
  if (!sampled) return null
  return (
    <div className="field-banner field-banner-quiet">
      <p>Sample notes are mixed in with yours.</p>
      <button type="button" onClick={onRemove}>Remove the samples</button>
    </div>
  )
}
