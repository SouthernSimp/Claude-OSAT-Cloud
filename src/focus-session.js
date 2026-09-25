export const FOCUS_STORAGE_KEY = 'nateos.focus.v1'
export const FOCUS_MINUTES = 25

export function focusRemaining(session, now = Date.now()) {
  if (session?.status === 'paused') return Math.max(0, Number(session.remainingMs) || 0)
  if (session?.status === 'running') return Math.max(0, (Number(session.endsAt) || 0) - now)
  return FOCUS_MINUTES * 60_000
}

export function normalizeFocusSession(value, now = Date.now()) {
  if (!value || !['running', 'paused'].includes(value.status)) return { status: 'idle' }
  const remainingMs = focusRemaining(value, now)
  return remainingMs > 0 ? { ...value, remainingMs } : { status: 'idle' }
}

export function startFocusSession(now = Date.now()) {
  const remainingMs = FOCUS_MINUTES * 60_000
  return { status: 'running', endsAt: now + remainingMs, remainingMs }
}

export function pauseFocusSession(session, now = Date.now()) {
  const remainingMs = focusRemaining(session, now)
  return remainingMs > 0 ? { status: 'paused', remainingMs } : { status: 'idle' }
}

export function resumeFocusSession(session, now = Date.now()) {
  const remainingMs = focusRemaining(session, now)
  return remainingMs > 0 ? { status: 'running', endsAt: now + remainingMs, remainingMs } : { status: 'idle' }
}
