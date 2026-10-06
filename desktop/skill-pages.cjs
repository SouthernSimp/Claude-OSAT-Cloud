/* The two scripts a skill runs inside a web page in OSAT's browser (Phase 19). `recorder` watches what the person does and
   reports each step through the console (`<prefix>{json}`, the prefix a secret only main knows, so the page can't write steps: the one door out of an isolated world); `replay` does one
   step. They are ordinary functions written out as source, so tests/skills.test.mjs runs them in a real browser page.
   Nothing is read from the page except what a step names; a password field's words are never read. */

function recorder(prefix) {
  if (window.__osatRecording === prefix) return
  window.__osatRecording = prefix
  const say = (step) => console.debug(`${prefix}${JSON.stringify(step)}`)
  const clean = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
  const esc = (value) => (window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/[^\w-]/g, '\\$&'))
  const one = (selector) => { try { return document.querySelectorAll(selector).length === 1 } catch { return false } }
  const labelOf = (el) => clean(el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.placeholder || el.getAttribute('title') || el.name || el.id, 80)
  const textOf = (el) => clean(el.innerText || el.value || el.getAttribute('aria-label') || el.title || el.alt, 80)
  const selectorOf = (el) => {
    if (el.id && one(`#${esc(el.id)}`)) return `#${esc(el.id)}`
    for (const attr of ['data-testid', 'name', 'aria-label', 'placeholder', 'title']) {
      const value = el.getAttribute(attr)
      const selector = value && `${el.localName}[${attr}="${value.replace(/"/g, '\\"')}"]`
      if (selector && one(selector)) return selector
    }
    const parts = []
    for (let node = el; node && node.nodeType === 1 && node !== document.body && parts.length < 6; node = node.parentElement) {
      const same = [...(node.parentElement?.children || [])].filter((child) => child.localName === node.localName)
      parts.unshift(node.localName + (same.length > 1 ? `:nth-of-type(${same.indexOf(node) + 1})` : ''))
    }
    return parts.join(' > ')
  }
  const target = (el, field) => ({ text: field ? '' : textOf(el), label: labelOf(el), selector: selectorOf(el) })
  const TEXTY = /^(text|email|search|url|tel|number|password|date|datetime-local|month|week|time|)$/i
  const entry = (el) => el && ((el.localName === 'input' && TEXTY.test(el.type)) || el.localName === 'textarea')
  const secretive = (el) => el.type === 'password' || /^(cc-|one-time-code)/.test(el.autocomplete || '') || /pass|pwd|secret|token|cvv|cvc|card|ssn|otp|\bpin\b/i.test(`${el.name} ${el.id} ${labelOf(el)}`)
  const seen = new WeakMap()
  const typed = (el) => {
    if (el.localName === 'select') {
      say({ do: 'choose', target: target(el, true), value: clean(el.selectedOptions?.[0]?.textContent || el.value, 200) })
    } else if (secretive(el)) {
      say({ do: 'secret', target: target(el, true) })
    } else if (seen.get(el) !== el.value) {
      seen.set(el, el.value)
      say({ do: 'type', target: target(el, true), value: el.value })
    }
  }
  document.addEventListener('click', (event) => {
    if (!event.isTrusted) return
    const el = event.target.closest?.('a,button,[role=button],[role=link],[role=tab],[role=menuitem],summary,label,input,select,option,[onclick]') || event.target
    if (!el || entry(el) || el.localName === 'select' || el.localName === 'option' || (el.localName === 'label' && (entry(el.control) || el.control?.localName === 'select'))) return
    say({ do: 'click', target: target(el, false) })
  }, true)
  document.addEventListener('change', (event) => {
    const el = event.target
    if (event.isTrusted && (entry(el) || el.localName === 'select')) typed(el)
  }, true)
  document.addEventListener('keydown', (event) => {
    const el = event.target
    if (!event.isTrusted || event.key !== 'Enter' || !entry(el) || el.localName === 'textarea') return
    typed(el)
    say({ do: 'press', key: 'Enter' })
  }, true)
}

/* Does one step, finding its target by the page's own selector, else by the words it was known by. Waits up to 8 seconds
   for it to appear. → { ok: true, secret? } or { ok: false, reason }. */
async function replay(step) {
  const lower = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const shown = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
  const labelOf = (el) => lower(el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.placeholder || el.getAttribute('title') || el.name || el.id)
  const textOf = (el) => lower(el.innerText || el.value || el.getAttribute('aria-label') || el.title || el.alt)
  const CLICKABLE = 'a,button,[role=button],[role=link],[role=tab],[role=menuitem],summary,label,input[type=submit],input[type=button],input[type=checkbox],input[type=radio],[onclick]'
  const field = step.do !== 'click'
  const t = step.target || {}
  const name = lower(field ? t.label : t.text || t.label)
  const says = (el) => (field ? labelOf(el) : textOf(el) || labelOf(el))
  const locate = () => {
    let bySelector = null
    try { bySelector = t.selector ? document.querySelector(t.selector) : null } catch { /* a selector the page no longer understands */ }
    if (bySelector && !shown(bySelector)) bySelector = null
    if (bySelector && (!name || says(bySelector).includes(name) || name.includes(says(bySelector)))) return bySelector
    const pool = [...document.querySelectorAll(field ? 'input,textarea,select' : CLICKABLE)].filter(shown)
    const byName = name && (pool.find((el) => says(el) === name) || pool.find((el) => says(el).includes(name)))
    return byName || bySelector
  }
  let el = null
  for (let waited = 0; waited <= 8000 && !(el = locate()); waited += 250) await sleep(250)
  if (step.do === 'press') {
    const active = document.activeElement
    for (const type of ['keydown', 'keypress', 'keyup']) {
      const accepted = (active || document.body).dispatchEvent(new KeyboardEvent(type, { key: step.key, code: step.key, bubbles: true, cancelable: true }))
      if (type === 'keydown' && accepted && step.key === 'Enter' && active?.form) {
        if (active.form.requestSubmit) active.form.requestSubmit()
        else active.form.submit()
      }
    }
    return { ok: true }
  }
  if (!el) return { ok: false, reason: 'missing' }
  el.scrollIntoView({ block: 'center' })
  if (step.do === 'click') { el.click(); return { ok: true } }
  el.focus()
  if (step.do === 'secret') return { ok: true, secret: true }
  if (step.do === 'choose') {
    const option = [...el.options].find((item) => lower(item.textContent) === lower(step.value)) || [...el.options].find((item) => item.value === step.value)
    if (!option) return { ok: false, reason: 'option' }
    el.value = option.value
  } else {
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
    if (set) set.call(el, step.value)
    else el.value = step.value
  }
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return { ok: true }
}

/* `nonce` is made fresh for each recording. */
const stepPrefix = (nonce) => `__osat_step_${nonce}__`
const recorderSource = (nonce) => `(${recorder})(${JSON.stringify(stepPrefix(nonce))})`
const replaySource = (step) => `(${replay})(${JSON.stringify(step)})`

module.exports = { recorder, replay, recorderSource, replaySource, stepPrefix }
