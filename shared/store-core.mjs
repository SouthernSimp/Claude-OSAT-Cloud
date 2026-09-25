/* The workspace store, shared by the Electron main process, every window and
   the tests. The document is plain JSON. Windows never send whole documents:
   they send small operations (add / patch / del / order / set), the main
   process applies them in one order, bumps `rev`, saves, and tells the other
   windows. Everything here is pure and has no dependencies. */

export const SCHEMA = 1

/* Arrays of records with a string `id`, diffed record by record. */
export const COLLECTIONS = [
  'notes', 'folders', 'habits', 'reflections', 'projects',
  'sorter.boards', 'calendar.events', 'budget.transactions', 'budget.recurring',
]

/* Top-level keys a window may change. `rev` and `schema` belong to the store. */
export const ROOTS = [
  'theme', 'notes', 'folders', 'habits', 'reflections', 'focus', 'projects',
  'sorter', 'calendar', 'budget', 'settings',
]

/* Future schema changes go here as { from, run(doc) → doc }. Each runs once, in order. */
export const migrations = []

export function createEmptyDoc() {
  return {
    schema: SCHEMA,
    rev: 0,
    theme: 'system',
    notes: [],
    folders: [],
    habits: [],
    reflections: [],
    focus: { status: 'idle' },
    projects: [],
    sorter: null,
    calendar: { events: [] },
    budget: { currency: 'USD', transactions: [], recurring: [] },
    settings: {},
  }
}

export function migrate(doc, list = migrations) {
  let current = isPlainObject(doc) ? doc : createEmptyDoc()
  const start = Number.isInteger(current.schema) ? current.schema : SCHEMA
  if (start > SCHEMA) throw new Error(`This data was saved by a newer OSAT (schema ${start}). Update OSAT to open it.`)
  for (const step of list) {
    if (step.from >= start && step.from < SCHEMA) current = { ...step.run(current), schema: step.from + 1 }
  }
  return { ...current, schema: SCHEMA, rev: Number.isInteger(current.rev) ? current.rev : 0 }
}

/* ---------- small helpers ---------- */

export function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

const COLLECTION_SET = new Set(COLLECTIONS)
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const SEGMENT = /^[A-Za-z0-9_-]{1,80}$/
const ID = /^[^\u0000-\u001f]{1,200}$/

const split = (path) => path.split('.')
const hasCollectionBelow = (path) => COLLECTIONS.some((collection) => collection.startsWith(`${path}.`))
const insideCollection = (path) => COLLECTIONS.some((collection) => path.startsWith(`${collection}.`))

function getAt(doc, path) {
  let cursor = doc
  for (const key of split(path)) {
    if (!isPlainObject(cursor)) return undefined
    cursor = cursor[key]
  }
  return cursor
}

/* Immutable set: copies only the objects along the path. `undefined` removes the key. */
function setAt(doc, path, value) {
  const keys = split(path)
  const write = (node, index) => {
    const base = isPlainObject(node) ? node : {}
    const key = keys[index]
    const copy = { ...base }
    if (index === keys.length - 1) {
      if (value === undefined) delete copy[key]
      else copy[key] = value
    } else {
      copy[key] = write(base[key], index + 1)
    }
    return copy
  }
  return write(doc, 0)
}

const listAt = (doc, path) => (Array.isArray(getAt(doc, path)) ? getAt(doc, path) : [])

/* ---------- validation (the main process never trusts a window) ---------- */

function validPath(path) {
  if (typeof path !== 'string' || !path) return false
  const keys = split(path)
  if (!ROOTS.includes(keys[0])) return false
  return keys.every((key) => SEGMENT.test(key) && !FORBIDDEN_KEYS.has(key)) && !insideCollection(path)
}

function assertRecord(value, what) {
  if (!isPlainObject(value)) throw new Error(`INVALID_OPS: ${what} must be a plain object`)
  for (const key of Object.keys(value)) if (FORBIDDEN_KEYS.has(key)) throw new Error(`INVALID_OPS: ${what} has a forbidden key`)
}

export function validateOps(ops) {
  if (!Array.isArray(ops)) throw new Error('INVALID_OPS: expected a list')
  if (ops.length > 20000) throw new Error('INVALID_OPS: too many operations')
  for (const op of ops) {
    if (!isPlainObject(op)) throw new Error('INVALID_OPS: an operation must be an object')
    if (op.t === 'set') {
      if (!validPath(op.p)) throw new Error(`INVALID_OPS: cannot set ${String(op.p)}`)
      continue
    }
    if (!COLLECTION_SET.has(op.c)) throw new Error(`INVALID_OPS: unknown collection ${String(op.c)}`)
    if (op.t === 'add') {
      assertRecord(op.v, 'an added record')
      if (typeof op.v.id !== 'string' || !ID.test(op.v.id)) throw new Error('INVALID_OPS: an added record needs an id')
      if (op.at !== undefined && !Number.isInteger(op.at)) throw new Error('INVALID_OPS: bad position')
    } else if (op.t === 'patch') {
      if (typeof op.id !== 'string' || !ID.test(op.id)) throw new Error('INVALID_OPS: patch needs an id')
      assertRecord(op.v, 'a patch')
      if ('id' in op.v && op.v.id !== op.id) throw new Error('INVALID_OPS: a patch cannot change an id')
      if (op.unset !== undefined && (!Array.isArray(op.unset) || op.unset.some((key) => typeof key !== 'string' || key === 'id' || FORBIDDEN_KEYS.has(key)))) {
        throw new Error('INVALID_OPS: bad unset list')
      }
    } else if (op.t === 'del') {
      if (typeof op.id !== 'string' || !ID.test(op.id)) throw new Error('INVALID_OPS: delete needs an id')
    } else if (op.t === 'order') {
      if (!Array.isArray(op.ids) || op.ids.some((id) => typeof id !== 'string')) throw new Error('INVALID_OPS: order needs ids')
    } else {
      throw new Error(`INVALID_OPS: unknown operation ${String(op.t)}`)
    }
  }
  return ops
}

/* ---------- applying ---------- */

function applyOne(doc, op, inverse) {
  if (op.t === 'set') {
    const before = getAt(doc, op.p)
    const value = op.del ? undefined : op.v
    if (before === value) return doc
    inverse.push(before === undefined ? { t: 'set', p: op.p, del: true } : { t: 'set', p: op.p, v: before })
    return setAt(doc, op.p, value)
  }
  const list = listAt(doc, op.c)
  if (op.t === 'add') {
    if (list.some((item) => item?.id === op.v.id)) return doc
    const at = Number.isInteger(op.at) ? Math.max(0, Math.min(op.at, list.length)) : list.length
    inverse.push({ t: 'del', c: op.c, id: op.v.id })
    return setAt(doc, op.c, [...list.slice(0, at), op.v, ...list.slice(at)])
  }
  const index = op.t === 'order' ? -1 : list.findIndex((item) => item?.id === op.id)
  if (op.t === 'patch') {
    if (index < 0) return doc
    const before = list[index]
    const next = { ...before, ...op.v }
    for (const key of op.unset || []) delete next[key]
    const restore = {}, removed = []
    for (const key of [...Object.keys(op.v), ...(op.unset || [])]) {
      if (key in before) restore[key] = before[key]
      else removed.push(key)
    }
    inverse.push({ t: 'patch', c: op.c, id: op.id, v: restore, ...(removed.length ? { unset: removed } : {}) })
    const copy = [...list]
    copy[index] = next
    return setAt(doc, op.c, copy)
  }
  if (op.t === 'del') {
    if (index < 0) return doc
    inverse.push({ t: 'add', c: op.c, v: list[index], at: index })
    return setAt(doc, op.c, [...list.slice(0, index), ...list.slice(index + 1)])
  }
  // order: listed ids first in the given order, anything unlisted keeps its place after them
  const byId = new Map(list.map((item) => [item?.id, item]))
  const listed = op.ids.filter((id) => byId.has(id))
  const rest = list.filter((item) => !op.ids.includes(item?.id))
  const next = [...listed.map((id) => byId.get(id)), ...rest]
  if (next.every((item, i) => item === list[i])) return doc
  inverse.push({ t: 'order', c: op.c, ids: list.map((item) => item?.id) })
  return setAt(doc, op.c, next)
}

/* Returns the new document and the operations that would undo this batch. */
export function applyOps(doc, ops) {
  const inverse = []
  let current = doc
  for (const op of ops) current = applyOne(current, op, inverse)
  return { doc: current, inverse: inverse.reverse() }
}

/* ---------- diffing (how a window turns "old state → new state" into operations) ---------- */

/* Deep equality for JSON values, so a freshly rebuilt but identical record is not a change. */
export function same(a, b) {
  if (a === b) return true
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, i) => same(item, b[i]))
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((key) => key in b && same(a[key], b[key]))
  }
  return false
}

function diffCollection(path, before, after, ops) {
  const a = Array.isArray(before) ? before : []
  const b = Array.isArray(after) ? after : []
  const old = new Map(a.map((item) => [item?.id, item]))
  const now = new Set(b.map((item) => item?.id))
  const order = a.map((item) => item?.id).filter((id) => now.has(id))
  for (const item of a) if (!now.has(item?.id)) ops.push({ t: 'del', c: path, id: item.id })
  b.forEach((item, at) => {
    const previous = old.get(item?.id)
    if (previous === undefined) {
      ops.push({ t: 'add', c: path, v: item, at })
      order.splice(Math.min(at, order.length), 0, item.id)
      return
    }
    if (previous === item) return
    const v = {}, unset = []
    for (const key of Object.keys(item)) if (!same(item[key], previous[key])) v[key] = item[key]
    for (const key of Object.keys(previous)) if (!(key in item)) unset.push(key)
    if (Object.keys(v).length || unset.length) ops.push({ t: 'patch', c: path, id: item.id, v, ...(unset.length ? { unset } : {}) })
  })
  const wanted = b.map((item) => item?.id)
  if (order.some((id, i) => id !== wanted[i])) ops.push({ t: 'order', c: path, ids: wanted })
}

function diffValue(path, before, after, ops) {
  if (before === after) return
  if (COLLECTION_SET.has(path) && (Array.isArray(before) || before == null) && Array.isArray(after)) {
    diffCollection(path, before, after, ops)
  } else if (hasCollectionBelow(path) && isPlainObject(before) && isPlainObject(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) diffValue(`${path}.${key}`, before[key], after[key], ops)
  } else if (after === undefined) {
    ops.push({ t: 'set', p: path, del: true })
  } else if (!same(before, after)) {
    ops.push({ t: 'set', p: path, v: after })
  }
}

export function diffDocs(before, after) {
  const ops = []
  if (before === after) return ops
  for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    if (key === 'rev' || key === 'schema' || !ROOTS.includes(key)) continue
    diffValue(key, before?.[key], after?.[key], ops)
  }
  return ops
}

/* Folds many small operations (one per keystroke) into as few as possible. */
export function compactOps(ops) {
  const out = []
  const lastFor = new Map() // "collection\u0000id" → index in out of an add/patch we can fold into
  const setFor = new Map()
  for (const op of ops) {
    if (op.t === 'patch') {
      const key = `${op.c}\u0000${op.id}`
      const index = lastFor.get(key)
      if (index !== undefined) {
        const target = out[index]
        if (target.t === 'add') {
          const v = { ...target.v, ...op.v }
          for (const field of op.unset || []) delete v[field]
          out[index] = { ...target, v }
        } else {
          const v = { ...target.v, ...op.v }
          const unset = new Set(target.unset || [])
          for (const field of Object.keys(op.v)) unset.delete(field)
          for (const field of op.unset || []) { unset.add(field); delete v[field] }
          out[index] = { ...target, v, ...(unset.size ? { unset: [...unset] } : {}) }
          if (!unset.size) delete out[index].unset
        }
        continue
      }
      lastFor.set(key, out.push(op) - 1)
    } else if (op.t === 'add') {
      lastFor.set(`${op.c}\u0000${op.v.id}`, out.push(op) - 1)
    } else if (op.t === 'set') {
      for (const [path, index] of setFor) {
        if (path === op.p || path.startsWith(`${op.p}.`) || op.p.startsWith(`${path}.`)) setFor.delete(path)
        if (path === op.p) out[index] = null
      }
      setFor.set(op.p, out.push(op) - 1)
    } else {
      // A delete or reorder ends folding for that collection, so order is kept exactly.
      for (const key of lastFor.keys()) if (key.startsWith(`${op.c}\u0000`)) lastFor.delete(key)
      out.push(op)
    }
  }
  return out.filter(Boolean)
}

/* ---------- the hub: one authoritative document and the windows attached to it ---------- */

export function createHub(initial = createEmptyDoc()) {
  let doc = initial
  const clients = new Map()
  let nextId = 1
  const broadcast = (message, except) => {
    for (const [id, listener] of clients) if (id !== except) listener(message)
  }
  return {
    get doc() { return doc },
    get rev() { return doc.rev },
    connect(listener) {
      const id = nextId++
      clients.set(id, listener)
      return id
    },
    disconnect(id) { clients.delete(id) },
    commit(from, ops) {
      validateOps(ops)
      const applied = applyOps(doc, ops).doc
      doc = { ...applied, rev: doc.rev + 1 }
      broadcast({ rev: doc.rev, ops }, from)
      return { rev: doc.rev }
    },
    /* Import / restore: a whole new document for everyone, the sender included. */
    replace(next) {
      if (!isPlainObject(next)) throw new Error('INVALID_DOC: expected an object')
      doc = { ...migrate(next), rev: doc.rev + 1 }
      broadcast({ rev: doc.rev, reset: true, doc })
      return { rev: doc.rev }
    },
  }
}
