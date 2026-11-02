/* The time of day, in words: the iPhone app's greeting (surfaces/Phone.jsx). The rest of the old desk's layout went
   with the desk (Phase 73, removed in Phase 115). Pure. */

const PHASES = {
  morning: ['Good morning.', 'The day has not asked for much yet.'],
  afternoon: ['Good afternoon.', 'Set down what you are carrying.'],
  evening: ['Good evening.', 'The room is yours again.'],
  night: ['Still here.', 'Leave it on the desk. Morning can take the rest.'],
}

export function dayPhase(date = new Date()) {
  const hour = date.getHours()
  if (hour < 5) return 'night'
  if (hour < 11) return 'morning'
  if (hour < 17) return 'afternoon'
  if (hour < 21) return 'evening'
  return 'night'
}

export function phaseCopy(phase) {
  return PHASES[phase] || PHASES.afternoon
}
