/* Keeping devices in step (the Mac, the iPhone, another Mac). Pure, like store-core.

   Every change a device makes is an operation (see store-core.mjs) stamped with a
   hybrid clock: `<wall ms>.<counter>.<device>`, fixed width, so stamps sort as text
   and a later change always has a larger stamp. Each device remembers, for every
   record and field, the stamp of the value it holds (`meta`). Merging another
   device's operations keeps, field by field, whichever value has the larger stamp,
   so every device ends up with the same workspace whatever order changes arrive in.

   meta = {
     rec:   { "<collection>\u0000<id>": { a: added, d?: deleted, f?: { field: stamp },
              p?: { field: value }, pu?: [field] } },   // p/pu: fields for a record not seen yet
     set:   { "<path>": stamp },
     order: { "<collection>": stamp },
   }
   A delete wins over earlier changes; adding the same record again later (Undo) brings it back.

   Note text is special: two versions written without seeing each other (the Mac and
   the iPhone both adding a step to today's page) are both kept. Each note's text
   carries a version vector (`v`: { device: its latest stamp in this text }); when
   neither version has seen the other, the result is the newer text plus the lines
   only the older one has (mergeText). */

import { COLLECTIONS, ROOTS, isPlainObject } from './store-core.mjs'

const COLLECTION_SET = new Set(COLLECTIONS)
const listAt = (doc, path) => {
  let cursor = doc
  for (const key of path.split('.')) cursor = isPlainObject(cursor) ? cursor[key] : undefined
  return Array.isArray(cursor) ? cursor : []
}
const hasCollectionBelow = (path) => COLLECTIONS.some((collection) => collection.startsWith(`${path}.`))
const keyOf = (collection, id) => `${collection}\u0000${id}`
const newer = (stamp, than) => than === undefined || stamp > than
const TEXT = { notes: new Set(['markdown']) }
const isText = (collection, field) => Boolean(TEXT[collection]?.has(field))
const deviceOf = (stamp) => String(stamp).split('.')[2]

/* Version vectors: { device: stamp }. `a` has seen `b` when it has everything b has. */
const hasSeen = (a = {}, b = {}) => Object.entries(b).every(([device, stamp]) => a[device] !== undefined && a[device] >= stamp)
const joined = (a = {}, b = {}) => {
  const out = { ...a }
  for (const [device, stamp] of Object.entries(b)) if (out[device] === undefined || stamp > out[device]) out[device] = stamp
  return out
}

/* The newer text, plus the lines only the older one has, in their order. A step
   checked on one device and not the other counts as the same line. */
const lineKey = (line) => line.trim().replace(/^([-*+])\s+\[[ xX]\]\s+/, '$1 [] ')
export function mergeText(newer, older) {
  const text = String(newer ?? '')
  const have = new Set(text.split('\n').map(lineKey).filter(Boolean))
  const extra = []
  for (const line of String(older ?? '').split('\n')) {
    const key = lineKey(line)
    if (!key || have.has(key)) continue
    have.add(key)
    extra.push(line)
  }
  return extra.length ? `${text.replace(/\s+$/, '')}\n${extra.join('\n')}\n` : text
}

export const emptyMeta = () => ({ rec: {}, set: {}, order: {} })

/* ---------- the clock ---------- */

export function createClock(device, now = Date.now, last = '') {
  if (!/^[A-Za-z0-9-]{1,40}$/.test(device)) throw new Error('A device id is letters, digits and dashes.')
  let wall = 0
  let count = 0
  const format = () => `${String(wall).padStart(13, '0')}.${String(count).padStart(6, '0')}.${device}`
  const observe = (stamp) => {
    const [w, c] = String(stamp).split('.')
    const seenWall = Number(w)
    const seenCount = Number(c)
    if (!Number.isFinite(seenWall) || !Number.isFinite(seenCount)) return
    if (seenWall > wall || (seenWall === wall && seenCount > count)) {
      wall = seenWall
      count = seenCount
    }
  }
  if (last) observe(last)
  return {
    /* A stamp larger than every stamp this device has made or seen. */
    tick() {
      const time = now()
      if (time > wall) {
        wall = time
        count = 0
      } else {
        count += 1
      }
      return format()
    },
    observe,
    get last() { return wall ? format() : '' },
  }
}

export const compareStamps = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/* ---------- walking a workspace: its records and its plain values ---------- */

export function walkDoc(doc, { record = () => {}, value = () => {} }) {
  const visit = (path, current) => {
    if (COLLECTION_SET.has(path)) {
      if (Array.isArray(current)) current.forEach((item, at) => { if (typeof item?.id === 'string') record(path, item, at) })
    } else if (hasCollectionBelow(path) && isPlainObject(current)) {
      for (const key of Object.keys(current)) visit(`${path}.${key}`, current[key])
    } else if (current !== undefined) {
      value(path, current)
    }
  }
  for (const key of ROOTS) if (doc && key in doc) visit(key, doc[key])
}

/* The oldest possible stamp for a device: what it held before it ever synced
   loses to any real change made anywhere, and ties go the same way everywhere. */
export const baseStamp = (device) => `${'0'.repeat(13)}.${'0'.repeat(6)}.${device}`

/* The first time a device syncs, everything it already holds is stamped once (with baseStamp). */
export function stampWorkspace(doc, meta, stamp) {
  walkDoc(doc, {
    record: (collection, item) => { meta.rec[keyOf(collection, item.id)] ??= { a: stamp } },
    value: (path) => { meta.set[path] ??= stamp },
  })
  return meta
}

/* ---------- this device's own changes ---------- */

/* Stamps operations the store has just applied here and notes them in meta. */
export function stampLocal(meta, ops, clock) {
  const entries = []
  for (const op of ops) {
    const stamp = clock.tick()
    if (op.t === 'set') meta.set[op.p] = stamp
    else if (op.t === 'order') meta.order[op.c] = stamp
    else if (op.t === 'add') {
      const record = (meta.rec[keyOf(op.c, op.v.id)] = { a: stamp })
      const vv = {}
      for (const field of Object.keys(op.v)) if (isText(op.c, field)) vv[field] = { [deviceOf(stamp)]: stamp }
      if (Object.keys(vv).length) {
        record.v = vv
        entries.push([stamp, { ...op, vv: structuredClone(vv) }]) // the log keeps its own copy
        continue
      }
    } else {
      const record = (meta.rec[keyOf(op.c, op.id)] ??= {})
      if (op.t === 'del') record.d = stamp
      else {
        for (const field of [...Object.keys(op.v || {}), ...(op.unset || [])]) (record.f ??= {})[field] = stamp
        const vv = {}
        for (const field of Object.keys(op.v || {})) {
          if (!isText(op.c, field)) continue
          vv[field] = { ...(record.v?.[field] || {}), [deviceOf(stamp)]: stamp }
          ;(record.v ??= {})[field] = vv[field]
        }
        if (Object.keys(vv).length) {
          entries.push([stamp, { ...op, vv: structuredClone(vv) }])
          continue
        }
      }
    }
    entries.push([stamp, op])
  }
  return entries
}

/* ---------- other devices' changes ---------- */

const fieldStamp = (record, field) => record.f?.[field] ?? record.a

/* Folds stamped operations from other devices into this one. Returns the operations
   to apply to this device's workspace (only what actually wins) and updates meta.
   `ops.share` lists merged note texts this device should pass on as its own new
   change, so every device settles on the same merge (see mergeField). */
export function mergeEntries(doc, meta, entries) {
  const lists = new Map()
  const present = (collection, id) => {
    if (!lists.has(collection)) lists.set(collection, new Set(listAt(doc, collection).map((item) => item?.id)))
    return lists.get(collection).has(id)
  }
  // Text as it stands after what this merge has already decided.
  const written = new Map()
  const textNow = (collection, id, field) => {
    const key = `${keyOf(collection, id)}\u0000${field}`
    return written.has(key) ? written.get(key) : listAt(doc, collection).find((item) => item?.id === id)?.[field]
  }
  const remember = (collection, id, field, value) => written.set(`${keyOf(collection, id)}\u0000${field}`, value)
  const share = new Set()

  /* One text field arriving for a record this device holds. Returns the text to
     write here, or undefined when this device's text stays as it is. */
  const mergeField = (op, id, record, field, value, stamp) => {
    const theirs = op.vv?.[field] || {}
    const ours = record.v?.[field] || {}
    const current = textNow(op.c, id, field) ?? ''
    const later = newer(stamp, fieldStamp(record, field))
    const settle = (text) => {
      ;(record.v ??= {})[field] = joined(ours, theirs)
      if (later) (record.f ??= {})[field] = stamp
      if (text === undefined || text === current) return undefined
      remember(op.c, id, field, text)
      return text
    }
    if (value === current) return settle(undefined)
    const sameVersion = hasSeen(theirs, ours) && hasSeen(ours, theirs)
    if (!sameVersion && hasSeen(theirs, ours)) { // theirs was written on top of ours
      ;(record.v ??= {})[field] = theirs
      if (later) (record.f ??= {})[field] = stamp
      remember(op.c, id, field, value)
      share.delete(`${keyOf(op.c, id)}\u0000${field}`) // it already holds any merge made here
      return value
    }
    if (!sameVersion && hasSeen(ours, theirs)) return undefined // ours already includes theirs
    // Written without seeing each other: keep both. With three or more devices the
    // order of merging could differ, so the merge is passed on as a new change.
    const merged = later ? mergeText(value, current) : mergeText(current, value)
    if (merged !== value) share.add(`${keyOf(op.c, id)}\u0000${field}`)
    return settle(merged)
  }

  const out = []
  for (const [stamp, op] of [...entries].sort((a, b) => compareStamps(a[0], b[0]))) {
    if (op.t === 'set') {
      if (newer(stamp, meta.set[op.p])) {
        meta.set[op.p] = stamp
        out.push(op)
      }
      continue
    }
    if (op.t === 'order') {
      if (newer(stamp, meta.order[op.c])) {
        meta.order[op.c] = stamp
        out.push(op)
      }
      continue
    }
    const id = op.t === 'add' ? op.v?.id : op.id
    if (typeof id !== 'string') continue
    const record = (meta.rec[keyOf(op.c, id)] ??= {})

    if (op.t === 'add') {
      // An add loses to a later delete.
      if (!newer(stamp, record.d)) continue
      if (present(op.c, id)) {
        // Both devices made the same record (a day's page): merge it field by field.
        const v = {}
        for (const [field, value] of Object.entries(op.v)) {
          if (field === 'id') continue
          if (isText(op.c, field)) {
            const text = mergeField(op, id, record, field, value, stamp)
            if (text !== undefined) v[field] = text
          } else if (newer(stamp, fieldStamp(record, field))) {
            v[field] = value
            ;(record.f ??= {})[field] = stamp
          }
        }
        if (Object.keys(v).length) out.push({ t: 'patch', c: op.c, id, v })
        continue
      }
      if (!newer(stamp, record.a)) continue // a later add of it was already undone here
      // Fields changed on another device before this add arrived still win.
      const value = { ...op.v }
      for (const [field, pending] of Object.entries(record.p || {})) if (record.f?.[field] > stamp) value[field] = pending
      for (const field of record.pu || []) if (record.f?.[field] > stamp) delete value[field]
      const keep = Object.fromEntries(Object.entries(record.f || {}).filter(([, fieldAt]) => fieldAt > stamp))
      const vectors = { ...(op.vv || {}) }
      for (const field of Object.keys(keep)) if (record.v?.[field]) vectors[field] = joined(vectors[field], record.v[field])
      meta.rec[keyOf(op.c, id)] = { a: stamp, ...(Object.keys(keep).length ? { f: keep } : {}), ...(Object.keys(vectors).length ? { v: vectors } : {}) }
      lists.get(op.c).add(id)
      for (const field of Object.keys(vectors)) remember(op.c, id, field, value[field])
      const { vv, ...plain } = op
      out.push({ ...plain, v: value })
      continue
    }

    if (op.t === 'patch') {
      const v = {}
      const unset = []
      const here = present(op.c, id)
      for (const [field, value] of Object.entries(op.v || {})) {
        if (field === 'id') continue
        if (here && isText(op.c, field)) {
          const text = mergeField(op, id, record, field, value, stamp)
          if (text !== undefined) v[field] = text
        } else if (newer(stamp, fieldStamp(record, field))) {
          v[field] = value
          ;(record.f ??= {})[field] = stamp
          if (isText(op.c, field)) (record.v ??= {})[field] = joined(record.v?.[field], op.vv?.[field])
        }
      }
      for (const field of op.unset || []) {
        if (newer(stamp, fieldStamp(record, field))) { unset.push(field); (record.f ??= {})[field] = stamp }
      }
      if (!Object.keys(v).length && !unset.length) continue
      if (here) {
        out.push({ t: 'patch', c: op.c, id, v, ...(unset.length ? { unset } : {}) })
      } else if (newer(stamp, record.d)) {
        // The record hasn't arrived yet: keep these fields for when it does.
        record.p = { ...record.p, ...v }
        for (const field of unset) delete record.p[field]
        record.pu = [...new Set([...(record.pu || []).filter((field) => !(field in v)), ...unset])]
        if (!record.pu.length) delete record.pu
      }
      continue
    }

    if (op.t === 'del') {
      if (!newer(stamp, record.a) || !newer(stamp, record.d)) continue
      record.d = stamp
      if (present(op.c, id)) {
        lists.get(op.c).delete(id)
        out.push(op)
      }
    }
  }
  // Shared as the text stands after the whole batch.
  out.share = [...share].map((key) => key.split('\u0000')).filter(([collection, id]) => present(collection, id))
    .map(([collection, id, field]) => ({ t: 'patch', c: collection, id, v: { [field]: textNow(collection, id, field) ?? '' } }))
  return out
}

/* A whole workspace as stamped operations, so a device can catch up from another's
   snapshot by merging it like any other changes (nothing it already holds is lost). */
export function snapshotEntries(doc, meta) {
  const entries = []
  walkDoc(doc, {
    record: (collection, item, at) => {
      const record = meta.rec[keyOf(collection, item.id)]
      if (!record?.a) return
      const vectors = record.v || {}
      const later = Object.entries(record.f || {}).filter(([field, stamp]) => stamp > record.a && field in item)
      const base = { ...item }
      // A text changed after the add travels as its own later patch, with its vector.
      for (const [field] of later) if (isText(collection, field)) delete base[field]
      entries.push([record.a, { t: 'add', c: collection, v: base, at, ...(Object.keys(vectors).length ? { vv: Object.fromEntries(Object.entries(vectors).filter(([field]) => field in base)) } : {}) }])
      for (const [field, stamp] of later) entries.push([stamp, { t: 'patch', c: collection, id: item.id, v: { [field]: item[field] }, ...(vectors[field] ? { vv: { [field]: vectors[field] } } : {}) }])
    },
    value: (path, current) => {
      if (meta.set[path]) entries.push([meta.set[path], { t: 'set', p: path, v: current }])
    },
  })
  for (const [key, record] of Object.entries(meta.rec)) {
    const [collection, id] = key.split('\u0000')
    if (record.d) entries.push([record.d, { t: 'del', c: collection, id }])
    // Edits still waiting for their record travel with the snapshot too.
    for (const [field, value] of Object.entries(record.p || {})) entries.push([record.f[field], { t: 'patch', c: collection, id, v: { [field]: value } }])
    for (const field of record.pu || []) entries.push([record.f[field], { t: 'patch', c: collection, id, v: {}, unset: [field] }])
  }
  return entries
}
