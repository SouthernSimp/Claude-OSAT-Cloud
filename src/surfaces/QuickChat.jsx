import { useEffect, useState } from 'react'
import { Sparkle, X } from '@phosphor-icons/react'

import { LocalAssistant } from '../assistant/LocalAssistant.jsx'
import { useWorkspace } from '../store/useWorkspace.js'

/* The quick chat: Ask in a small window that floats over every app (⌥⇧Space).
   The same chats as the Ask room; the window keeps the one you were in between
   visits. Drag it by its top; Esc puts it away. */
export function QuickChatSurface() {
  const { workspace, commit, ready } = useWorkspace()
  const bridge = window.osatChat
  const [target, setTarget] = useState(null)

  /* Popped out of Ask or the desk: that chat. Summoned: the one you left, ready to type into. */
  useEffect(() => bridge?.onShown((detail) => {
    if (typeof detail?.chatId === 'string' || typeof detail?.prompt === 'string') setTarget({ ...detail, at: Date.now() })
    requestAnimationFrame(() => document.querySelector('.quick-chat .composer textarea')?.focus())
  }), [bridge])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      bridge?.hide()
    }
    addEventListener('keydown', onKey)
    // On the Mac, Esc arrives from the main process (the panel keeps it from the page).
    const stop = bridge?.onEscape(() => {
      const target = document.activeElement || document.body
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
    })
    return () => {
      removeEventListener('keydown', onKey)
      stop?.()
    }
  }, [bridge])

  return (
    <main className="quick-chat">
      <header className="quick-bar">
        <span><Sparkle weight="fill" /> OSAT</span>
        <button type="button" aria-label="Put the chat away" title="Put it away  esc" onClick={() => bridge?.hide()}><X weight="bold" /></button>
      </header>
      {ready && workspace && (
        <div className="quick-body">
          <LocalAssistant compact workspace={workspace} commit={commit} navigate={(view, detail) => bridge?.openInWindow(view, detail)} initialPrompt={target} />
        </div>
      )}
    </main>
  )
}
