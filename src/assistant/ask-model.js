import { getLocalModels, streamLocalMessage } from '../local-ai.js'
import { modelLabel } from './LocalAssistant.jsx'

/* The model OSAT answers with, as a name for a button, or null: the one chosen in
   Settings → Bots (a cloud model, while online), else the AI on this Mac. */
export const answeringLabel = (models) => (models?.length ? modelLabel(models[0]) : null)

/* One question to that model, for the small jobs (Unpack with AI, Help me sort). Resolves
   with the whole answer. */
export async function askModel(messages, { signal } = {}) {
  const [model] = await getLocalModels({ signal })
  if (!model) throw new Error('No AI is set up yet. Choose one in Settings → AI, or connect a cloud model in Settings → Bots.')
  return streamLocalMessage({ model: model.id, messages, signal })
}
