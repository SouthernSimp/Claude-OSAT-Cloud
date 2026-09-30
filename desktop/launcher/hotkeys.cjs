/* The launcher's own global shortcuts (Phase 13): a Hyper key for each source, window layouts, the ring.
   Each has an id; `set` gives it a key (or takes it away) and says whether the Mac let it. The desk's,
   the quick chat's and the quick search's shortcuts stay in main.cjs (`shortcuts`); `isTaken` asks main
   whether a key is one of those, so the two never fight over a key. */

function createHotkeys({ globalShortcut, isTaken = () => false }) {
  const held = new Map() // id → the key it holds now
  const failed = new Set()

  function clear(id) {
    const key = held.get(id)
    if (key) globalShortcut.unregister(key)
    held.delete(id)
    failed.delete(id)
  }

  /* `run` is called a moment after the keys go down (a panel shown while they are still down can lose
     focus). → true when the key is registered (or was taken away). */
  function set(id, accelerator, run) {
    if (!accelerator) { clear(id); return true }
    if (held.get(id) === accelerator) return true
    clear(id)
    // A key another of OSAT's shortcuts (or this id's neighbour) holds is not OSAT's to share.
    let ok = false
    if (!isTaken(accelerator, id) && ![...held.entries()].some(([other, key]) => other !== id && key === accelerator)) {
      try { ok = globalShortcut.register(accelerator, () => setTimeout(run, 60)) } catch { ok = false }
    }
    if (ok) held.set(id, accelerator)
    else failed.add(id)
    return ok
  }

  return {
    set,
    clear,
    /* Keeps exactly `wanted` ({ id: { key, run } }): what is not wanted any more goes. */
    sync(wanted) {
      for (const id of [...held.keys(), ...failed]) if (!(id in wanted)) clear(id)
      for (const [id, { key, run }] of Object.entries(wanted)) set(id, key, run)
      return [...failed]
    },
    has: (accelerator, exceptId) => [...held.entries()].some(([id, key]) => key === accelerator && id !== exceptId),
    failed: () => [...failed],
    keys: () => Object.fromEntries(held),
    stop() {
      for (const id of [...held.keys()]) clear(id)
    },
  }
}

module.exports = { createHotkeys }
