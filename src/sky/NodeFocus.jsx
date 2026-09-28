import { useRef, useState } from 'react'
import { ArrowLeft, ArrowsHorizontal, ArrowsVertical, DotsThree, LinkSimple, Plus, Sparkle, X } from '@phosphor-icons/react'

import { carryable, useDrop } from '../lib/carry.js'
import { folderChildren, folderPath, folderSubtree } from '../notes-model.js'
import { linkedWith, nodesOf, pileOf } from '../nodes-model.js'
import { NameField, StickyList } from './Piles.jsx'

/* Branches inside a folder, deepest last, each with how deep it sits. */
function branchTree(folders, parentId, depth = 0) {
  return folderChildren(folders, parentId).flatMap((folder) => [{ folder, depth }, ...branchTree(folders, folder.id, depth + 1)])
}

/* One node laid out to work in: each branch is a lane of stickies ranked left to right
   (Across), or a column ranked top to bottom (Down); the stickies still to sort are the
   last lane (the first column). On the left, every node in order, each with a glance at
   what's in it; resting on one shows more. Linked nodes are listed underneath and open
   beside this one, so stickies can be dragged across. */
export function NodeFocus({ workspace, actions, nodeId, onFocus, onBack, sorting }) {
  const folder = workspace.folders.find((item) => item.id === nodeId)
  const [beside, setBeside] = useState(null)
  const [renaming, setRenaming] = useState(false)
  if (!folder) return null
  const nodes = nodesOf(workspace.folders)
  const number = nodes.find((item) => item.folder.id === folder.id)?.number
  const path = folderPath(workspace.folders, folder.parentId)
  const layout = folder.layout === 'down' ? 'down' : 'across'
  const linked = linkedWith(workspace.folders, folder.id).map((id) => workspace.folders.find((item) => item.id === id)).filter(Boolean)
  const shownBeside = linked.find((item) => item.id === beside)
  const topId = path.length ? workspace.folders.find((item) => folderSubtree(workspace.folders, item.id).has(folder.id) && !item.parentId)?.id : folder.id

  return (
    <div className="node-focus">
      <NodeList workspace={workspace} nodes={nodes} current={topId} actions={actions} onFocus={onFocus} onBack={onBack} />
      <section className="focus-main" aria-label={folder.name}>
        <header className="focus-head">
          <button type="button" className="focus-back" onClick={onBack} title="All nodes  Esc"><ArrowLeft weight="bold" /> All nodes</button>
          {number && <span className="node-number is-inline" data-paper={folder.color || 'canary'}>{number}</span>}
          <div className="focus-title">
            {path.length > 0 && <small>{path.join(' › ')}</small>}
            {renaming
              ? <NameField initial={folder.name} placeholder="Name" className="is-title" onDone={(name) => { setRenaming(false); if (name) actions.rename(folder.id, name) }} />
              : <h2><button type="button" title="Rename" onClick={() => setRenaming(true)}>{folder.name}</button></h2>}
          </div>
          <div className="segmented focus-layout" role="radiogroup" aria-label="How to lay it out">
            <button type="button" role="radio" aria-checked={layout === 'across'} title="Branches as lanes, ranked left to right" onClick={() => actions.setLayout(folder.id, 'across')}><ArrowsHorizontal /> Across</button>
            <button type="button" role="radio" aria-checked={layout === 'down'} title="Branches as columns, ranked top to bottom" onClick={() => actions.setLayout(folder.id, 'down')}><ArrowsVertical /> Down</button>
          </div>
          <button type="button" className="focus-sort" onClick={() => actions.sort(folder.id)} disabled={sorting?.id === folder.id && sorting.busy} title="Suggest a branch for each sticky still to sort">
            <Sparkle weight={sorting?.id === folder.id ? 'fill' : 'regular'} /> {sorting?.id === folder.id ? sorting.line : 'Help me sort'}
          </button>
          <button type="button" className="focus-more" aria-label={`More for ${folder.name}`} onClick={(event) => actions.nodeMenu(event, folder)}><DotsThree weight="bold" /></button>
        </header>

        <NodeBoard folder={folder} workspace={workspace} actions={actions} layout={layout} />

        <footer className="focus-links">
          <span><LinkSimple weight="bold" /> Linked</span>
          {linked.map((item) => (
            <button key={item.id} type="button" className={`link-chip ${beside === item.id ? 'is-on' : ''}`} data-paper={item.color || 'canary'} onClick={() => setBeside((id) => (id === item.id ? null : item.id))}>
              {item.name}
            </button>
          ))}
          <button type="button" className="link-add" onClick={(event) => actions.linkMenu(event, folder)}><Plus weight="bold" /> Link a node</button>
        </footer>

        {shownBeside && (
          <section className="focus-beside" aria-label={`${shownBeside.name}, beside`}>
            <header>
              <strong>{shownBeside.name}</strong>
              <button type="button" onClick={() => onFocus(shownBeside.id)}>Open</button>
              <button type="button" aria-label="Put it away" onClick={() => setBeside(null)}><X weight="bold" /></button>
            </header>
            <NodeBoard folder={shownBeside} workspace={workspace} actions={actions} layout={shownBeside.layout === 'down' ? 'down' : 'across'} compact />
          </section>
        )}
      </section>
    </div>
  )
}

/* A node's branches as lanes or columns, and its stickies still to sort. */
function NodeBoard({ folder, workspace, actions, layout, compact = false }) {
  const [naming, setNaming] = useState(false)
  const across = layout === 'across'
  const branches = branchTree(workspace.folders, folder.id)
  const loose = pileOf(workspace.notes, folder.id)
  const lanes = useDrop(`focus:lanes:${folder.id}${compact ? ':beside' : ''}`, {
    accepts: (carried) => carried.kind === 'folder' && !folderSubtree(workspace.folders, carried.id).has(folder.id),
    axis: across ? 'y' : 'x',
    onDrop: ({ id, index }) => actions.moveFolder(id, folder.id, index),
  })
  const toSort = (
    <Lane key="loose" loose folder={folder} notes={loose} actions={actions} across={across} suggestions={actions.suggestionsFor(folder.id)} />
  )
  return (
    <div className={`lanes is-${layout} ${compact ? 'is-compact' : ''}`} {...lanes}>
      {!across && toSort}
      {branches.map(({ folder: branch, depth }) => (
        <Lane key={branch.id} folder={branch} depth={depth} notes={pileOf(workspace.notes, branch.id)} actions={actions} across={across} />
      ))}
      {naming
        ? <div className="lane is-naming"><NameField placeholder="Name the branch, like #N2D" onDone={(name) => { setNaming(false); if (name) actions.addBranch(name, folder.id) }} /></div>
        : <button type="button" className="lane-add" onClick={() => setNaming(true)}><Plus weight="bold" /> Branch</button>}
      {across && toSort}
    </div>
  )
}

function Lane({ folder, notes, actions, across, depth = 0, loose = false, suggestions }) {
  const [renaming, setRenaming] = useState(false)
  const head = useDrop(`focus:lane-head:${loose ? 'loose:' : ''}${folder.id}`, {
    accepts: ['note'],
    onDrop: ({ id }) => actions.moveSticky(id, folder.id),
  })
  const count = suggestions?.size || 0
  return (
    <section className={`lane ${loose ? 'is-loose' : ''}`} data-slot={loose || depth ? undefined : ''} style={{ '--depth': depth }} aria-label={loose ? 'To sort' : folder.name}>
      <div
        className="lane-head"
        data-paper={loose ? undefined : folder.color || 'bone'}
        {...head}
        {...(loose ? {} : carryable({ kind: 'folder', id: folder.id, data: { parentId: folder.parentId } }))}
        onDoubleClick={() => { if (!loose) setRenaming(true) }}
        onContextMenu={loose ? undefined : (event) => actions.branchMenu(event, folder)}
      >
        {loose
          ? <strong>To sort</strong>
          : renaming
            ? <NameField initial={folder.name} placeholder="Name" onDone={(name) => { setRenaming(false); if (name) actions.rename(folder.id, name) }} />
            : <strong>{depth > 0 ? '↳ ' : ''}{folder.name}</strong>}
        {loose && count > 0 && <button type="button" className="lane-accept" onClick={() => actions.acceptAll(folder.id)}>Move all {count === 1 ? 'one' : 'of them'}</button>}
        {!loose && <button type="button" className="lane-more" aria-label={`More for ${folder.name}`} onClick={(event) => actions.branchMenu(event, folder)}><DotsThree weight="bold" /></button>}
      </div>
      <StickyList
        id={`focus:${loose ? 'loose' : 'lane'}:${folder.id}`}
        folderId={folder.id}
        notes={notes}
        axis={across ? 'x' : 'y'}
        actions={actions}
        paper={!loose && folder.color && folder.color !== 'bone' ? folder.color : 'canary'}
        adding={loose ? 'Write a sticky' : 'Add'}
        suggestions={suggestions}
      />
    </section>
  )
}

/* Every node in order, to hop between them; a node's bars show its branches at a glance
   and resting on it shows what's inside. Stickies and branches can be dropped on one. */
function NodeList({ workspace, nodes, current, actions, onFocus, onBack }) {
  const [peek, setPeek] = useState(null)
  const timer = useRef(0)
  return (
    <aside className="node-list" aria-label="Nodes">
      <button type="button" className="node-list-all" onClick={onBack}>All nodes</button>
      <div className="node-list-scroll">
        {nodes.map(({ folder, number }) => (
          <NodeListItem
            key={folder.id}
            folder={folder}
            number={number}
            workspace={workspace}
            actions={actions}
            current={folder.id === current}
            peeking={peek === folder.id}
            onPeek={(on) => {
              clearTimeout(timer.current)
              if (on) timer.current = setTimeout(() => setPeek(folder.id), 350)
              else setPeek((id) => (id === folder.id ? null : id))
            }}
            onFocus={onFocus}
          />
        ))}
      </div>
    </aside>
  )
}

function NodeListItem({ folder, number, workspace, actions, current, peeking, onPeek, onFocus }) {
  const branches = folderChildren(workspace.folders, folder.id)
  const drop = useDrop(`focus:list:${folder.id}`, {
    accepts: (carried) => carried.kind === 'note' || (carried.kind === 'folder' && Boolean(carried.data?.parentId) && !folderSubtree(workspace.folders, carried.id).has(folder.id)),
    onDrop: (carried) => (carried.kind === 'note' ? actions.moveSticky(carried.id, folder.id) : actions.moveFolder(carried.id, folder.id)),
  })
  const loose = pileOf(workspace.notes, folder.id)
  const slot = useRef(null)
  // Beside the list, above everything: the list scrolls, so the glance can't live inside it.
  const at = peeking && slot.current?.getBoundingClientRect()
  return (
    <div ref={slot} className="node-list-slot" onPointerEnter={() => onPeek(true)} onPointerLeave={() => onPeek(false)}>
      <button type="button" className={`node-list-item ${current ? 'is-current' : ''}`} aria-current={current || undefined} {...drop} onClick={() => onFocus(folder.id)}>
        <span className="node-number is-small" data-paper={folder.color || 'canary'}>{number}</span>
        <strong>{folder.name}</strong>
        <span className="node-bars" aria-hidden="true">
          {branches.slice(0, 6).map((branch) => (
            <i key={branch.id} data-paper={branch.color || 'bone'} style={{ '--n': Math.min(8, pileOf(workspace.notes, branch.id).length + 1) }} />
          ))}
          {loose.length > 0 && <i className="is-loose" style={{ '--n': Math.min(8, loose.length + 1) }} />}
        </span>
      </button>
      {peeking && (
        <div className="node-peek" role="tooltip" style={at ? { top: Math.min(at.top, innerHeight - 320), left: at.right + 10 } : undefined}>
          <strong>{folder.name}</strong>
          {branches.length === 0 && loose.length === 0 && <p>Nothing in it yet.</p>}
          {branches.map((branch) => {
            const notes = pileOf(workspace.notes, branch.id)
            return (
              <div key={branch.id} className="peek-branch">
                <b>{branch.name}</b>
                {notes.slice(0, 2).map((note) => <span key={note.id}>{note.title}</span>)}
              </div>
            )
          })}
          {loose.length > 0 && (
            <div className="peek-branch is-loose">
              <b>To sort</b>
              {loose.slice(0, 3).map((note) => <span key={note.id}>{note.title}</span>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
