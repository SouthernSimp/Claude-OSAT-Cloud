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

