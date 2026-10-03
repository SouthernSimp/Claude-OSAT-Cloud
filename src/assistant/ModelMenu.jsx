import { useEffect, useRef, useState } from 'react'
import { CaretDown, Check, GearSix, Sparkle } from '@phosphor-icons/react'

const uses = { light: 'Quick tasks and short questions', balanced: 'Everyday writing and thinking', deep: 'More demanding questions' }
const loadedLine = (tier) => tier?.state === 'loading' ? 'Loading…' : tier?.state === 'unloading' ? 'Unloading…' : tier?.busy ? 'Busy' : tier?.state === 'ready' ? tier.retained ? 'Ready · kept loaded' : 'Ready' : tier?.state === 'error' ? 'Needs attention' : 'Downloaded · loads on your next question'

export const memoryResult = (result) => {
  if (result.cancelled) return 'No models were unloaded.'
  const busy = (result.busyModels || []).map((id) => result.tiers?.find((tier) => tier.id === id)?.label || id).join(', ')
  if (busy) return (result.unloaded?.length ? 'Freed idle AI memory. ' : '') + busy + ' stays loaded until its work finishes.'
  return result.unloaded?.length ? 'AI memory released. Your next question can load it again.' : 'No models were unloaded.'
}

/* The model is a conversation choice. Changing it never starts a download or
   changes another conversation. The main process reviews memory when it loads. */
export function ModelMenu({ models = [], status, value, onChange, disabled = false, bridge, navigate, onMessage }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const selected = models.find((model) => model.id === value)
  const chosenTier = status?.tiers.find((tier) => 'osat:' + tier.id === value)
  const label = chosenTier?.label || selected?.label || selected?.name || (value ? 'Model unavailable' : 'Choose a model')
  const close = () => { setOpen(false); ref.current?.querySelector('button')?.focus() }

  useEffect(() => {
    if (!open) return undefined
    const outside = (event) => { if (!ref.current?.contains(event.target)) setOpen(false) }
    const escape = (event) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); ref.current?.querySelector('button')?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    ref.current?.querySelector('[role="menuitemradio"][aria-checked="true"]')?.focus()
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true) }
  }, [open])

  function keys(event) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const items = [...ref.current.querySelectorAll('[role="menuitemradio"]:not(:disabled), [role="menuitem"]:not(:disabled)')]
    const current = items.indexOf(document.activeElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  async function free() {
    close()
    try {
      const result = await bridge.freeMemory()
      onMessage?.(memoryResult(result))
    } catch (error) { onMessage?.(String(error.message || error)) }
  }

  return (
    <div ref={ref} className="ai-model-menu">
      <button className="outline-button ai-model-trigger" type="button" aria-label={'Model: ' + label} aria-haspopup="menu" aria-expanded={open}
        disabled={disabled} onClick={() => setOpen((value) => !value)}><Sparkle /> <span>{label}</span><CaretDown /></button>
      {open && <div className="ai-model-options" role="menu" aria-label="Choose a model" onKeyDown={keys}>
        <p className="ai-menu-caption">For this conversation</p>
        {(status?.tiers || []).map((tier) => {
          const id = 'osat:' + tier.id
          return <button key={id} type="button" role="menuitemradio" aria-checked={value === id} disabled={!tier.ready}
            onClick={() => { onChange(id); close() }}>
            <span><strong>{tier.label}{tier.id === status.recommended && <em>Recommended</em>}</strong>
              <small>{uses[tier.id]}</small><small>{tier.model} · {tier.ready ? loadedLine(tier) : 'Download in AI settings'}</small></span>
            {value === id && <Check />}
          </button>
        })}
        {models.filter((model) => model.runtime !== 'osat').map((model) => <button key={model.id} type="button" role="menuitemradio" aria-checked={value === model.id}
          onClick={() => { onChange(model.id); close() }}><span><strong>{model.name || model.id}</strong><small>{model.offline === false ? 'Connected cloud model' : 'Through LM Studio'}</small></span>{value === model.id && <Check />}</button>)}
        <div className="ai-menu-footer">
          {bridge?.freeMemory && <button type="button" role="menuitem" onClick={free}>Free AI memory</button>}
          <button type="button" role="menuitem" onClick={() => { setOpen(false); navigate?.('Settings', { section: 'ai' }) }}><GearSix /> AI settings</button>
        </div>
      </div>}
    </div>
  )
}
