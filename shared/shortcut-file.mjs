/* Siri and Shortcuts (Phase 47): five ready-made shortcuts Nate adds from Settings → Bots.
   Each talks to the connector's plain web API on this Mac (desktop/bots/connector.cjs):
   POST /api/add_sticky, GET /api/read_journal…, with the key in an Authorization header,
   and the answer (plain words) shown or spoken. Pure: `shortcutFile(id, { api, key })` gives
   the file's name (also the words to say to Siri) and its text, an Apple property list in XML;
   desktop/bots/shortcuts.cjs signs it so Shortcuts will add it.
   The format is the one Shortcuts exports: each action is an identifier and its parameters;
   an earlier action's answer inside words is U+FFFC, with an `attachmentsByRange` entry at its
   place ("{index, 1}", counted in UTF-16 like JavaScript); a field of keys and values is a
   WFDictionaryFieldValue. Every input is named on purpose: Shortcuts passes nothing along by
   itself, and asks for whatever is left out. */

const OBJ = '￼'
const CLIENT_VERSION = '3036.0.4.2' // Shortcuts on macOS 15 / iOS 18; newer ones open it as it is
const BLUE = 463140863
// What "Send to OSAT" takes from the Share menu. Not Safari web pages: Safari would send the
// whole page; as a link (a URL) it sends the address, which is what a sticky wants.
const SHARED = ['WFStringContentItem', 'WFURLContentItem', 'WFRichTextContentItem']

export const SHORTCUTS = [
  { id: 'add', name: 'Add to OSAT', say: 'Say “Hey Siri, add to OSAT”, then what to keep. It lands in Unsorted.', glyph: 61464 },
  { id: 'send', name: 'Send to OSAT', say: 'In any app’s Share menu, and in Services when you select words. A link or words land in Unsorted.', glyph: 59708 },
  { id: 'write', name: 'Write in my OSAT journal', say: 'Say “Hey Siri, write in my OSAT journal”, then the line for today’s page.', glyph: 59798 },
  { id: 'read', name: "What's in my OSAT journal", say: 'Say “Hey Siri, what’s in my OSAT journal”, and Siri reads today’s page.', glyph: 59465 },
  { id: 'find', name: 'Find in OSAT', say: 'Say “Hey Siri, find in OSAT”, then a few words. It shows the stickies that hold them.', glyph: 59772 },
]

const uuid = (n) => `05A70000-0000-4000-8000-${String(n).padStart(12, '0')}`
const action = (id, params) => ({ WFWorkflowActionIdentifier: `is.workflow.actions.${id}`, WFWorkflowActionParameters: params })
const output = (id, name) => ({ Type: 'ActionOutput', OutputUUID: id, OutputName: name })
const INPUT = { Type: 'ExtensionInput' } // what the Share menu handed over

/* Words, with each of `parts` where an OBJ is, in order. */
function words(string, ...parts) {
  const attachmentsByRange = {}
  let at = -1
  for (const part of parts) {
    at = string.indexOf(OBJ, at + 1)
    attachmentsByRange[`{${at}, 1}`] = part
  }
  return { Value: parts.length ? { string, attachmentsByRange } : { string }, WFSerializationType: 'WFTextTokenString' }
}

/* A field of text keys and values: the headers, or a JSON body. */
const field = (pairs) => ({
  Value: { WFDictionaryFieldValueItems: pairs.map(([key, value]) => ({ WFItemType: 0, WFKey: words(key), WFValue: value })) },
  WFSerializationType: 'WFDictionaryFieldValue',
})

/* Get Contents of URL on one of the connector's tools, with the key. */
function request(where, tool, { id, url, json }) {
  return action('downloadurl', {
    UUID: id,
    WFURL: url || words(`${where.api}/${tool}`),
    WFHTTPMethod: json ? 'POST' : 'GET',
    ShowHeaders: true,
    WFHTTPHeaders: field([['Authorization', words(`Bearer ${where.key}`)]]),
    ...(json ? { WFHTTPBodyType: 'JSON', WFJSONValues: field(json) } : {}),
  })
}

const ask = (id, prompt) => action('ask', { UUID: id, WFAskActionPrompt: prompt, WFInputType: 'Text' })
const answer = (id) => words(OBJ, output(id, 'Contents of URL'))
const notify = (id) => action('notification', { WFNotificationActionTitle: 'OSAT', WFNotificationActionBody: answer(id) })
const show = (id) => action('showresult', { Text: answer(id) })
const said = (id) => words(OBJ, output(id, 'Provided Input'))

function actionsFor(id, where) {
  const [first, second, third] = [uuid(1), uuid(2), uuid(3)]
  if (id === 'add') return [ask(first, 'What should OSAT keep?'), request(where, 'add_sticky', { id: second, json: [['text', said(first)], ['source', words('Siri')]] }), notify(second)]
  if (id === 'send') return [request(where, 'add_sticky', { id: first, json: [['text', words(OBJ, INPUT)], ['source', words('Share')]] }), notify(first)]
  if (id === 'write') return [ask(first, 'What should go in today’s journal?'), request(where, 'add_to_journal', { id: second, json: [['text', said(first)]] }), notify(second)]
  if (id === 'read') return [request(where, 'read_journal', { id: first }), show(first)]
  if (id === 'find') {
    return [
      ask(first, 'What should OSAT look for?'),
      action('urlencode', { UUID: second, WFInput: said(first), WFEncodeMode: 'Encode' }),
      request(where, 'search', { id: third, url: words(`${where.api}/search?query=${OBJ}`, output(second, 'URL Encoded Text')) }),
      show(third),
    ]
  }
  throw new Error(`OSAT has no shortcut called “${String(id).slice(0, 40)}”.`)
}

/* The whole shortcut, as the property list's object. The key only ever goes to this Mac. */
export function shortcutPlan(id, where) {
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/api$/.test(where?.api || '')) throw new Error('Shortcuts only talk to OSAT on this Mac.')
  if (!/^[\x21-\x7e]{8,400}$/.test(where?.key || '')) throw new Error('Turn on the connector first.')
  const item = SHORTCUTS.find((shortcut) => shortcut.id === id)
  const actions = actionsFor(id, where)
  const shared = id === 'send'
  return {
    WFWorkflowActions: actions,
    WFWorkflowClientVersion: CLIENT_VERSION,
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowMinimumClientVersionString: '900',
    WFWorkflowIcon: { WFWorkflowIconGlyphNumber: item.glyph, WFWorkflowIconStartColor: BLUE },
    WFWorkflowImportQuestions: [],
    WFWorkflowInputContentItemClasses: shared ? SHARED : [],
    WFWorkflowOutputContentItemClasses: [],
    // The Share menu, and Quick Actions (the Services menu) on the Mac; run on its own, it asks.
    WFWorkflowTypes: shared ? ['ActionExtension', 'QuickActions'] : [],
    WFQuickActionSurfaces: shared ? ['Services'] : [],
    WFWorkflowHasShortcutInputVariables: shared,
    ...(shared ? { WFWorkflowNoInputBehavior: { Name: 'WFWorkflowNoInputBehaviorAskForInput', Parameters: { ItemClass: 'WFStringContentItem' } } } : {}),
  }
}

const escape = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/* An object as an XML property list's value: strings, true/false, whole numbers, lists, dicts. */
export function plistValue(value) {
  if (typeof value === 'string') return `<string>${escape(value)}</string>`
  if (typeof value === 'boolean') return value ? '<true/>' : '<false/>'
  if (Number.isInteger(value)) return `<integer>${value}</integer>`
  if (Array.isArray(value)) return value.length ? `<array>${value.map(plistValue).join('')}</array>` : '<array/>'
  return `<dict>${Object.entries(value).map(([key, item]) => `<key>${escape(key)}</key>${plistValue(item)}`).join('')}</dict>`
}

/* { name, text }: the file's name is the shortcut's, and what Siri listens for. */
export function shortcutFile(id, where) {
  const plan = shortcutPlan(id, where)
  const { name } = SHORTCUTS.find((shortcut) => shortcut.id === id)
  const text = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
${plistValue(plan)}
</plist>
`
  return { name, text }
}
