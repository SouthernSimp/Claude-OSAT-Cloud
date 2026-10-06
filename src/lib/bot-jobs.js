/* Bots that can take a job from the line's `>` (Phase 13). Each is { id, name, run(job) }. Today the one taker is Skills
   (Phase 19, "Record a skill"): `>pay rent` runs the skill with that name, in the Browser room so you can watch it
   (a name that matches nothing just opens the room, where the skills are listed). More bots register here, and the line
   never changes (shared/launcher-model.mjs `handOff` picks the taker and says so plainly when there is none). */
import { skillForJob } from '../../shared/skill-model.mjs'

export const botTakers = ({ navigate } = {}) => (typeof window !== 'undefined' && window.osatSkills && navigate
  ? [{
    id: 'skills',
    name: 'Skills',
    async run(job) {
      navigate('Browser')
      const skill = skillForJob(await window.osatSkills.list().catch(() => []), job)
      if (skill) await window.osatSkills.run(skill.id).catch(() => {})
    },
  }]
  : [])
