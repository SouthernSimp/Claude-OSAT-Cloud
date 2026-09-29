import roadmap from '../../docs/ROADMAP.md?raw'
import { Markdown } from '../lib/markdown.jsx'

/* Where OSAT is going: docs/ROADMAP.md, built into the app, read-only. */
export function RoadmapView() {
  return (
    <div className="roadmap-room">
      <Markdown text={roadmap} headingOffset={1} />
    </div>
  )
}
