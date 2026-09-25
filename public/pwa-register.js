(() => {
  if (location.protocol === 'file:' || !window.isSecureContext || !('serviceWorker' in navigator)) return

  // A dev preview must always use current source. Keep its saved workspace intact.
  if (document.querySelector('script[src="/@vite/client"]')) {
    navigator.serviceWorker.getRegistrations().then(async (registrations) => {
      for (const registration of registrations) {
        if (registration.active?.scriptURL.startsWith(`${location.origin}/service-worker.js`)) await registration.unregister()
      }
      for (const key of await caches.keys()) if (key.startsWith('osat-shell-')) await caches.delete(key)
      if (navigator.serviceWorker.controller) location.reload()
    }).catch((error) => console.warn('Preview cache could not be refreshed.', error))
    return
  }

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js', {
        scope: './',
        updateViaCache: 'none',
      })
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => {})
      })
    } catch (error) {
      console.warn('OSAT offline mode is unavailable.', error)
    }
  }, { once: true })
})()
