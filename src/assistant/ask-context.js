import roadmap from '../../docs/ROADMAP.md?raw'
import { asksAboutPlan, boardMap, planLines } from './board-context.js'

/* What a question can see of OSAT: the map (board-context.js) and, when the question is
   about OSAT's plan, the roadmap's Status table (the same text the Roadmap room shows). Only
   for the windows: the roadmap is bundled in by Vite. `options` are boardMap's. */
export function askContext(workspace, question, options = {}) {
  const plan = asksAboutPlan(question)
  const map = boardMap(workspace, plan ? { ...options, maxChars: 1800 } : options)
  return plan ? `${map}\n\n${planLines(roadmap)}` : map
}
