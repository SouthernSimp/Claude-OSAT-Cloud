import { ArrowUpRight, Plus, Question, ShareNetwork, SquaresFour, Stack } from '@phosphor-icons/react'
import { folderChildren } from '../notes-model.js'
import { nodesOf } from '../nodes-model.js'

// Navigation stays outside the camera, so even a large or distant map is reachable.
export function SkyNavigator({ workspace, focus, unsortedCount, unsortedOpen, onOverview, onTopic, onBranch, onNew, onUnsorted, onGuide }) {
  const topics = nodesOf(workspace.folders)
  function branches(parent, depth = 0) {
    if (depth > 12) return null
    return folderChildren(workspace.folders, parent).map((folder) => <li key={folder.id}>
      <button type="button" className="sky-nav-branch" title={folder.name} onClick={() => onBranch(folder.id)}><span>{folder.name}</span><ArrowUpRight /></button>
      {folderChildren(workspace.folders, folder.id).length > 0 && <ul>{branches(folder.id, depth + 1)}</ul>}
    </li>)
  }
  return <aside className="sky-navigator" aria-label="Sky navigator">
    <div className="sky-nav-intro"><strong>Your thinking space</strong><p>Capture. Connect. Make room.</p></div>
    <nav aria-label="Sky views" className="sky-nav-views">
      <button type="button" aria-current={!focus && !unsortedOpen ? 'page' : undefined} onClick={onOverview}><SquaresFour /><span>All Sky</span></button>
      <button type="button" aria-expanded={unsortedOpen} aria-controls="sky-unsorted" onClick={onUnsorted}><Stack /><span>Unsorted</span><small>{unsortedCount || ''}</small></button>
    </nav>
    <div className="sky-nav-heading"><h2>Topics</h2><button type="button" aria-label="New node" title="New node" onClick={onNew}><Plus /></button></div>
    <nav className="sky-topic-list" aria-label="Sky topics">
      {topics.map(({ folder }) => <div className="sky-topic" key={folder.id}>
        <button type="button" className="sky-topic-link" aria-current={focus === folder.id ? 'page' : undefined} title={folder.name} onClick={() => onTopic(folder.id)}><i data-paper={folder.color || 'sky'} /><span>{folder.name}</span><ShareNetwork /></button>
        {focus === folder.id && <ul className="sky-branch-list">{branches(folder.id)}</ul>}
      </div>)}
      {!topics.length && <p className="sky-nav-empty">Start with a sticky. Add a topic when ideas begin to connect.</p>}
    </nav>
    <footer><button type="button" onClick={onGuide}><Question /> A quick guide <span>?</span></button><p>One canvas. Your own pace.</p></footer>
  </aside>
}
