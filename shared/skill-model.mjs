/* Skills (Phase 19, "Record a skill"): something done once in OSAT's own browser, written down step by step in plain
   words, saved under a name and replayed by one button. Pure: the page scripts that watch and replay are
   desktop/skill-pages.cjs, the file is desktop/skills.cjs, the screen is src/tools/Skills.jsx.
   A step is { do: 'go', url } | { do: 'click', target } | { do: 'type', target, value } | { do: 'choose', target, value }
   | { do: 'press', key } | { do: 'secret', target } (a password field: its words are never kept, the person types them).
   A target says what it is three ways, so a changed page can still be found: { text, label, selector }. */

export const MAX_STEPS = 60
export const MAX_SKILLS = 50

const text = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const WEB = /^https?:\/\/[^\s]+$/i

const cleanTarget = (value) => ({
  text: text(value?.text, 80),
  label: text(value?.label, 80),
  selector: text(value?.selector, 300),
})
const named = (target) => target.text || target.label

export function cleanStep(raw) {
  if (!raw || typeof raw !== 'object') return null
  switch (raw.do) {
    case 'go': return WEB.test(String(raw.url || '')) && String(raw.url).length <= 2000 ? { do: 'go', url: String(raw.url) } : null
    case 'click': { const target = cleanTarget(raw.target); return target.selector || named(target) ? { do: 'click', target } : null }
    case 'type':
    case 'choose': { const target = cleanTarget(raw.target); return target.selector || named(target) ? { do: raw.do, target, value: String(raw.value ?? '').slice(0, 2000) } : null }
    case 'secret': { const target = cleanTarget(raw.target); return target.selector || named(target) ? { do: 'secret', target } : null }
    case 'press': return ['Enter', 'Tab', 'Escape'].includes(raw.key) ? { do: 'press', key: raw.key } : null
    default: return null
  }
}

export const cleanSteps = (list) => (Array.isArray(list) ? list : []).map(cleanStep).filter(Boolean).slice(0, MAX_STEPS)

/* A skill is only ever read back through this: a name, the page it starts on, its steps. */
export function cleanSkill(raw) {
  const steps = cleanSteps(raw?.steps)
  const name = text(raw?.name, 60)
  if (!name || typeof raw?.id !== 'string' || !raw.id || steps[0]?.do !== 'go') return null
  return { id: raw.id.slice(0, 80), name, createdAt: text(raw.createdAt, 40), steps }
}

export function cleanSkills(list) {
  const seen = new Set()
  return (Array.isArray(list) ? list : []).map(cleanSkill).filter((skill) => skill && !seen.has(skill.id) && seen.add(skill.id)).slice(0, MAX_SKILLS)
}

const host = (url) => { try { return new URL(url).host.replace(/^www\./, '') } catch { return url } }
const call = (target) => `“${named(target) || 'it'}”`

/* A step in plain words. */
export function stepWords(step) {
  switch (step.do) {
    case 'go': return `Open ${host(step.url)}`
    case 'click': return `Click ${call(step.target)}`
    case 'type': return `Type “${text(step.value, 40)}” in ${call(step.target)}`
    case 'choose': return `Choose “${text(step.value, 40)}” in ${call(step.target)}`
    case 'press': return `Press ${step.key}`
    case 'secret': return `You type the password in ${call(step.target)}`
    default: return 'A step'
  }
}

/* A step the page reports while it is watched. Typing the same field again replaces the last typing; a repeat of
   the same click or key an instant later is one. → the new list of steps. */
export function addRecorded(steps, raw) {
  const step = cleanStep(raw)
  if (!step || steps.length >= MAX_STEPS) return steps
  const last = steps.at(-1)
  if (last && ['type', 'choose', 'secret'].includes(step.do) && last.do === step.do && last.target.selector === step.target.selector) return [...steps.slice(0, -1), step]
  if (last && JSON.stringify(last) === JSON.stringify(step) && step.do === 'press') return steps
  return [...steps, step]
}

/* Whether the skill needs the person at a step (a password). */
export const needsYou = (skill) => skill.steps.some((step) => step.do === 'secret')

export const newSkill = (name, steps, now = new Date()) => cleanSkill({ id: `skill-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name, createdAt: now.toISOString(), steps })

/* The skill a typed job names ("pay rent"), for the line's `>`: exact, then starts with, then contains. */
export function skillForJob(skills, job) {
  const word = text(job, 80).toLowerCase()
  if (!word) return null
  const lower = (skill) => skill.name.toLowerCase()
  return skills.find((skill) => lower(skill) === word) || skills.find((skill) => lower(skill).startsWith(word)) || skills.find((skill) => lower(skill).includes(word)) || null
}
