import { useEffect, useState } from 'react'

/* A sticky's screenshot (Hyper N): kept in OSAT's data folder on this Mac, asked for by name and remembered for the
   page's life. Elsewhere (the browser preview, the iPhone) it says where the picture is instead. */
const seen = new Map()

export function Picture({ name, width = 640, className = '' }) {
  const bridge = typeof window === 'undefined' ? null : window.osatSearch
  const key = `${name}@${width}`
  const [url, setUrl] = useState(() => seen.get(key) ?? null)
  useEffect(() => {
    if (seen.has(key) || !bridge?.picture) return undefined
    let live = true
    bridge.picture(name, width).then((value) => { seen.set(key, value || ''); if (live) setUrl(value || '') }, () => { if (live) setUrl('') })
    return () => { live = false }
  }, [bridge, key, name, width])
  if (url) return <img className={`osat-picture ${className}`.trim()} src={url} alt="Screenshot" draggable={false} />
  return <span className={`osat-picture is-missing ${className}`.trim()}>{url === '' || !bridge ? 'Screenshot on your Mac' : ''}</span>
}
