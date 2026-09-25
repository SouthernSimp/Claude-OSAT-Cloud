import { normalizeNote } from './osat-data.js'

const CHECKLIST = /^(\s*[-*+]\s+)\[([ xX])\](?:\s+)(.*)$/
const FENCE = /^\s*(`{3,}|~{3,})/

export function nextSteps(notes) {
  return (Array.isArray(notes) ? notes : []).flatMap((note) => {
    if (!note || typeof note.id !== 'string' || typeof note.markdown !== 'string') return []
    let fence = null
    return note.markdown.split('\n').flatMap((line, index) => {
      const marker = line.match(FENCE)?.[1]
      if (marker && (!fence || (marker[0] === fence.char && marker.length >= fence.length))) {
        fence = fence ? null : { char: marker[0], length: marker.length }
        return []
      }
      if (fence) return []
      const match = line.match(CHECKLIST)
      if (!match || !match[3].trim()) return []
      return [{
        id: `${note.id}:${index + 1}`,
        noteId: note.id,
        noteTitle: note.title,
        line: index + 1,
        text: match[3].trim(),
        done: match[2].toLowerCase() === 'x',
        tag: note.tags?.[0] || '',
      }]
    })
  })
}

export function toggleNextStep(notes, step, now = new Date().toISOString()) {
  if (!step || typeof step.noteId !== 'string' || !Number.isInteger(step.line) || typeof step.text !== 'string') return notes
  return (Array.isArray(notes) ? notes : []).map((note) => {
    if (note?.id !== step.noteId || typeof note.markdown !== 'string') return note
    if (!nextSteps([note]).some((item) => item.line === step.line && item.text === step.text.trim())) return note
    const lines = note.markdown.split('\n')
    const index = step.line - 1
    const current = lines[index]?.match(CHECKLIST)
    if (!current || current[3].trim() !== step.text.trim()) return note
    lines[index] = `${current[1]}[${current[2].toLowerCase() === 'x' ? ' ' : 'x'}]${current[0].slice(current[1].length + 3, current[0].length - current[3].length)}${current[3]}`
    return { ...note, markdown: lines.join('\n'), updatedAt: now }
  })
}

export function appendNextStep(notes, text, today) {
  if (typeof text !== 'string' || !text.trim() || /[\r\n]/.test(text) || typeof today !== 'string' || !today) return notes
  const cleanText = text.trim()
  const id = `daily-plan-${today}`
  const list = Array.isArray(notes) ? notes : []
  const existing = list.find((note) => note?.id === id)
  if (existing) {
    return list.map((note) => note.id === id ? { ...note, trashedAt: null, archived: false, markdown: `${note.markdown || ''}${note.markdown ? '\n' : ''}- [ ] ${cleanText}`, updatedAt: new Date().toISOString() } : note)
  }
  return [...list, normalizeNote({ id, title: 'Today’s next steps', tags: ['today'], markdown: `# Today\n\n- [ ] ${cleanText}` })]
}
