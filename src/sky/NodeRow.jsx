import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowsOut, DotsThree, Plus } from '@phosphor-icons/react'

import { carryable, useDrop } from '../lib/carry.js'
import { folderChildren, folderSubtree } from '../notes-model.js'
import { folderLinks, nodesOf, pileOf, stickiesIn } from '../nodes-model.js'
import { NameField, StickyList } from './Piles.jsx'

/* How thick a pile looks: a layer of paper for every few stickies, never a number. */
export const layersFor = (count) => Math.min(4, Math.ceil(count / 3))

/* The row of nodes, laid out like Nate's piles of stickies on his desk: every node's card
   sits on one line (the ground), numbered left to right. Open a node and its branches grow
   up from the ground (the first branch nearest it) while its stickies still to sort hang
   below. Unsorted is the pile at the far left. A node can be dragged to a new place (the
   numbers follow), a branch up or down or into another node, a sticky anywhere. Linked
   nodes are joined by an arc. Double-click a node, or its ⤢, to lay it out. */
export function NodeRow({ workspace, actions, open, toggle, onFocus }) {
  const nodes = nodesOf(workspace.folders)
  const grid = useRef(null)
  const scroller = useRef(null)
  const [arcs, setArcs] = useState([])
  const [naming, setNaming] = useState(false)
  const unsorted = pileOf(workspace.notes, null)
  const links = folderLinks(workspace.folders)
  const row = useDrop('sky:nodes', {
    accepts: ['folder'],
    axis: 'x',
    onDrop: ({ id, index }) => actions.moveFolder(id, null, index),
  })

  /* Start with the ground in view. */
  useLayoutEffect(() => {
    const view = scroller.current
    const ground = grid.current?.querySelector('.node-cell')
    if (view && ground) view.scrollTop = Math.max(0, ground.offsetTop - view.clientHeight * 0.38)
  }, [])

  /* The arcs between linked nodes, from the top of one card to the top of the other. */
  useLayoutEffect(() => {
    const element = grid.current
    if (!element) return undefined
    const measure = () => {
      const box = element.getBoundingClientRect()
      const at = (id) => {
        const card = element.querySelector(`[data-node-head="${id}"]`)
        if (!card) return null
        const rect = card.getBoundingClientRect()
        return { x: rect.left - box.left + rect.width / 2, y: rect.top - box.top }
      }
      setArcs(links.flatMap(({ a, b }) => {
        const from = at(a)
        const to = at(b)
        if (!from || !to) return []
        const lift = 26 + Math.abs(to.x - from.x) * 0.16
        return [{ key: `${a}|${b}`, d: `M${from.x} ${from.y + 6} C${from.x} ${from.y - lift},${to.x} ${to.y - lift},${to.x} ${to.y + 6}` }]
      }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [workspace.folders, workspace.notes, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const column = (index) => ({ gridColumn: index + 1 })

  return (
    <div className="node-scroll" ref={scroller}>
      <div className="node-grid" ref={grid} {...row} style={{ gridTemplateColumns: `repeat(${nodes.length + 2}, var(--node-w))` }}>
        <i className="node-ground" aria-hidden="true" />
        <svg className="node-links" aria-hidden="true">
          {arcs.map((arc) => <path key={arc.key} d={arc.d} />)}
        </svg>

        {/* Unsorted: the loose pile at the far left, always open. */}
        <div className="node-cell is-unsorted" style={{ ...column(0), gridRow: 2 }}>
          <UnsortedHead actions={actions} count={unsorted.length} />
        </div>
        <div className="node-below" style={{ ...column(0), gridRow: 3 }}>
          <StickyList id="sky:unsorted" folderId={null} notes={unsorted} actions={actions} adding="Write a thought" empty="Thoughts from the desk land here." />
        </div>

        {nodes.map(({ folder, number }, index) => {
          const isOpen = open.has(folder.id)
          const branches = folderChildren(workspace.folders, folder.id)
          return (
            <NodeColumn
              key={folder.id}
              folder={folder}
              number={number}
              index={index + 1}
              isOpen={isOpen}
              branches={branches}
              workspace={workspace}
              actions={actions}
              open={open}
              toggle={toggle}
              onFocus={onFocus}
            />
          )
        })}

        <div className="node-cell is-new" style={{ ...column(nodes.length + 1), gridRow: 2 }}>
          {naming
            ? <div className="node-head is-naming"><NameField placeholder="Name the node" onDone={(name) => { setNaming(false); if (name) actions.addNode(name) }} /></div>
            : <button type="button" className="node-head is-add" onClick={() => setNaming(true)}><Plus weight="bold" /> New node</button>}
        </div>
      </div>
    </div>
  )
}

function UnsortedHead({ actions, count }) {
  const drop = useDrop('sky:unsorted-head', { accepts: ['note'], onDrop: ({ id }) => actions.moveSticky(id, null, 0) })
  return (
    <div className="node-head is-unsorted" data-layers={layersFor(count)} {...drop}>
      <strong>Unsorted</strong>
      <small>Not in a node yet</small>
    </div>
  )
}

function NodeColumn({ folder, number, index, isOpen, branches, workspace, actions, open, toggle, onFocus }) {
  const [naming, setNaming] = useState(false)
  const loose = pileOf(workspace.notes, folder.id)
  const count = stickiesIn(workspace, folder.id).length
  // Branches grow up from the ground: the first one sits nearest the node.
  const upward = [...branches].reverse()
  const branchList = useDrop(`sky:branches:${folder.id}`, {
    accepts: (carried) => carried.kind === 'folder' && carried.id !== folder.id && !folderSubtree(workspace.folders, carried.id).has(folder.id),
    axis: 'y',
    onDrop: ({ id, index: at }) => {
      const others = branches.filter((branch) => branch.id !== id).length
      actions.moveFolder(id, folder.id, others - at)
    },
  })
  const head = useDrop(`sky:head:${folder.id}`, {
    // A sticky goes into its pile to sort; a branch (never a whole node) joins its branches.
    accepts: (carried) => carried.kind === 'note' || (carried.kind === 'folder' && Boolean(carried.data?.parentId) && !folderSubtree(workspace.folders, carried.id).has(folder.id)),
    onDrop: (carried) => (carried.kind === 'note' ? actions.moveSticky(carried.id, folder.id) : actions.moveFolder(carried.id, folder.id)),
    spring: () => { if (!open.has(folder.id)) toggle(folder.id, true) },
  })

  return (
    <>
      {isOpen && (
        <div className="node-above" style={{ gridColumn: index + 1, gridRow: 1 }} {...branchList}>
          {naming
            ? <div className="branch-head is-naming"><NameField placeholder="Name the branch, like #IDEAS" onDone={(name) => { setNaming(false); if (name) actions.addBranch(name, folder.id) }} /></div>
            : <button type="button" className="add-branch" onClick={() => setNaming(true)}><Plus weight="bold" /> Branch</button>}
          {upward.map((branch) => (
            <Branch key={branch.id} branch={branch} workspace={workspace} actions={actions} isOpen={open.has(branch.id)} toggle={toggle} />
          ))}
        </div>
      )}
      <div className="node-cell" data-slot style={{ gridColumn: index + 1, gridRow: 2 }}>
        <div
          className={`node-head ${isOpen ? 'is-open' : ''}`}
          data-node-head={folder.id}
          data-paper={folder.color || 'canary'}
          data-layers={isOpen ? 0 : layersFor(count)}
          role="button"
          tabIndex={0}
          aria-expanded={isOpen}
          aria-label={`Node ${number}: ${folder.name}`}
          {...head}
          {...carryable({ kind: 'folder', id: folder.id, data: { parentId: null } })}
          onClick={(event) => { if (event.detail < 2 && !event.target.closest('button, input')) toggle(folder.id) }}
          onDoubleClick={(event) => { if (!event.target.closest('button, input')) onFocus(folder.id) }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return
            if (event.key === 'Enter') { event.preventDefault(); onFocus(folder.id) }
            if (event.key === ' ') { event.preventDefault(); toggle(folder.id) }
          }}
          onContextMenu={(event) => actions.nodeMenu(event, folder)}
        >
          <span className="node-number" aria-hidden="true">{number}</span>
          {actions.renaming === folder.id
            ? <NameField initial={folder.name} placeholder="Name the node" onDone={(name) => actions.endRename(folder.id, name)} />
            : <strong>{folder.name}</strong>}
          {!isOpen && branches.length > 0 && <small>{branches.slice(0, 3).map((branch) => branch.name).join(', ')}</small>}
          <span className="node-tools">
            <button type="button" aria-label={`Lay out ${folder.name}`} title="Lay it out" onClick={() => onFocus(folder.id)}><ArrowsOut weight="bold" /></button>
            <button type="button" aria-label={`More for ${folder.name}`} title="More" onClick={(event) => actions.nodeMenu(event, folder)}><DotsThree weight="bold" /></button>
          </span>
        </div>
      </div>
      {isOpen && (
        <div className="node-below" style={{ gridColumn: index + 1, gridRow: 3 }}>
          <p className="pile-label">To sort</p>
          <StickyList
            id={`sky:loose:${folder.id}`}
            folderId={folder.id}
            notes={loose}
            actions={actions}
            adding="Write a sticky"
            suggestions={actions.suggestionsFor(folder.id)}
          />
        </div>
      )}
    </>
  )
}

function Branch({ branch, workspace, actions, isOpen, toggle }) {
  const notes = pileOf(workspace.notes, branch.id)
  const deeper = folderChildren(workspace.folders, branch.id)
  const head = useDrop(`sky:branch-head:${branch.id}`, {
    accepts: ['note'],
    onDrop: ({ id }) => actions.moveSticky(id, branch.id),
    spring: () => toggle(branch.id, true),
  })
  return (
    <div className={`branch ${isOpen ? 'is-open' : ''}`} data-slot>
      <div
        className="branch-head"
        data-paper={branch.color || 'bone'}
        data-layers={isOpen ? 0 : layersFor(notes.length)}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        {...head}
        {...carryable({ kind: 'folder', id: branch.id, data: { parentId: branch.parentId } })}
        onClick={(event) => { if (!event.target.closest('button, input')) toggle(branch.id) }}
        onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggle(branch.id) } }}
        onContextMenu={(event) => actions.branchMenu(event, branch)}
      >
        {actions.renaming === branch.id
          ? <NameField initial={branch.name} placeholder="Name the branch" onDone={(name) => actions.endRename(branch.id, name)} />
          : <strong>{branch.name}</strong>}
        {!isOpen && notes[0] && <small>{notes[0].title}</small>}
        <span className="node-tools">
          <button type="button" aria-label={`More for ${branch.name}`} title="More" onClick={(event) => actions.branchMenu(event, branch)}><DotsThree weight="bold" /></button>
        </span>
      </div>
      {isOpen && (
        <>
          {deeper.length > 0 && (
            <p className="branch-deeper">{deeper.map((item) => <button key={item.id} type="button" onClick={() => actions.focusOn(item.id)}>↳ {item.name}</button>)}</p>
          )}
          <StickyList id={`sky:branch:${branch.id}`} folderId={branch.id} notes={notes} actions={actions} paper={branch.color && branch.color !== 'bone' ? branch.color : 'canary'} />
        </>
      )}
    </div>
  )
}
