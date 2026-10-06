/* Ask's side of "copies and files" (the Mac app answers `osatSearch.askFind`; shared/ask-find.mjs does the choosing and
   leaves out anything that looks like a secret). Only a model on this Mac is ever given them: a cloud model, or a
   window without the bridge, gets nothing. A message keeps only pointers (which copy, which file), never their words. */

const bridge = () => (typeof window === 'undefined' ? null : window.osatSearch)

export const isLocalModel = (model) => model?.offline !== false

/* → { text, copies: [{ id, at }], files: [{ rootId, relative, name }] } (all empty when nothing applies). */
export async function findForAsk(question, local = true) {
  const none = { text: '', copies: [], files: [] }
  if (!local || !bridge()?.askFind) return none
  try {
    const found = await bridge().askFind(question)
    if (!found || found.off) return none
    return {
      text: String(found.text || ''),
      copies: (found.copies || []).map(({ id, at }) => ({ id, at })),
      files: (found.files || []).map(({ rootId, relative, name }) => ({ rootId, relative, name })),
    }
  } catch {
    return none
  }
}

/* The pointers a message keeps. */
export const sourceRefs = (found) => ({
  ...(found.copies.length ? { copies: found.copies } : {}),
  ...(found.files.length ? { fileRefs: found.files } : {}),
})
