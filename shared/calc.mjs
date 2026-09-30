/* The calculator in the line and the quick search (Phase 13): `2*49` answers in place. A small
   reader for sums, never eval: numbers, + - * / ^ %, brackets, a few functions (sqrt, abs, round,
   floor, ceil, min, max, sin, cos, tan, ln, log) and pi / e. "12% of 80" is 9.6 and "100 + 10%" is
   110. Only something that is a sum answers: a bare number or a word is not math. Pure. */

const FUNCTIONS = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  ln: Math.log, log: Math.log10, min: Math.min, max: Math.max, pow: Math.pow,
}
const CONSTANTS = { pi: Math.PI, e: Math.E }
const MAX_LENGTH = 120

function tokenize(text) {
  const tokens = []
  const source = text.replace(/[×∙·]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/\$/g, '')
  const pattern = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)|([a-z]+)|(.))/giy
  let match
  while ((match = pattern.exec(source)) && match[0] !== '') {
    if (match[1] !== undefined) tokens.push({ t: 'num', v: Number(match[1]) })
    else if (match[2] !== undefined) tokens.push(match[2].toLowerCase() === 'x' ? { t: 'op', v: '*' } : { t: 'word', v: match[2].toLowerCase() })
    else if (match[3].trim()) tokens.push({ t: 'op', v: match[3] })
  }
  return tokens
}

/* A recursive reader; throws on anything it doesn't understand. `calls` says a function was used. */
function parse(tokens) {
  let at = 0
  let depth = 0
  let signs = 0
  const peek = () => tokens[at]
  const take = (value) => (peek()?.t === 'op' && peek().v === value ? tokens[at++] : null)
  const must = (value) => { if (!take(value)) throw new Error('expected') }

  function expression() {
    if (++depth > 30) throw new Error('deep')
    let left = term()
    for (;;) {
      const op = take('+') ? '+' : take('-') ? '-' : null
      if (!op) break
      left = { t: 'bin', op, a: left, b: term() }
      signs += 1
    }
    depth -= 1
    return left
  }
  function term() {
    let left = unary()
    for (;;) {
      const op = take('*') ? '*' : take('/') ? '/' : null
      if (op) { left = { t: 'bin', op, a: left, b: unary() }; signs += 1; continue }
      // "12% of 80"
      if (left.t === 'pct' && peek()?.t === 'word' && peek().v === 'of') { at += 1; left = { t: 'bin', op: '*', a: left, b: unary() }; signs += 1; continue }
      break
    }
    return left
  }
  function unary() {
    if (take('-')) return { t: 'neg', a: unary() }
    if (take('+')) return unary()
    return power()
  }
  function power() {
    const base = postfix()
    if (take('^')) { signs += 1; return { t: 'bin', op: '^', a: base, b: unary() } }
    return base
  }
  function postfix() {
    let node = primary()
    while (take('%')) node = { t: 'pct', a: node }
    return node
  }
  function primary() {
    const token = tokens[at++]
    if (!token) throw new Error('short')
    if (token.t === 'num') return { t: 'num', v: token.v }
    if (token.t === 'op' && token.v === '(') { const inner = expression(); must(')'); return inner }
    if (token.t === 'word') {
      if (token.v in CONSTANTS) return { t: 'num', v: CONSTANTS[token.v] }
      if (token.v in FUNCTIONS && take('(')) {
        const args = [expression()]
        while (take(',')) args.push(expression())
        must(')')
        signs += 1
        return { t: 'fn', name: token.v, args }
      }
    }
    throw new Error('unknown')
  }

  const tree = expression()
  if (at !== tokens.length) throw new Error('left over')
  return { tree, hasOperator: signs > 0 }
}

function run(node) {
  switch (node.t) {
    case 'num': return node.v
    case 'neg': return -run(node.a)
    case 'pct': return run(node.a) / 100
    case 'fn': return FUNCTIONS[node.name](...node.args.map(run))
    default: {
      // 100 + 10% is 110: a percentage after + or - is a share of the left side.
      if ((node.op === '+' || node.op === '-') && node.b.t === 'pct') {
        const left = run(node.a)
        return node.op === '+' ? left + left * run(node.b) : left - left * run(node.b)
      }
      const [a, b] = [run(node.a), run(node.b)]
      return { '+': a + b, '-': a - b, '*': a * b, '/': a / b, '^': a ** b }[node.op]
    }
  }
}

/* 98 → "98", 1/3 → "0.3333333333", 1234567.5 → "1,234,567.5" (`plain` has no commas, for copying). */
export function formatNumber(value) {
  if (Math.abs(value) >= 1e15 || (value !== 0 && Math.abs(value) < 1e-9)) {
    const exponent = value.toExponential(9).replace(/\.?0+e/, 'e')
    return { text: exponent, plain: exponent }
  }
  const rounded = Number(value.toPrecision(12))
  const plain = String(rounded)
  return { text: rounded.toLocaleString('en-US', { maximumFractionDigits: 10 }), plain }
}

/* "2*49" → { value: 98, text: '98', plain: '98' }; null when it isn't a sum (or can't be worked out). */
export function calculate(input) {
  const raw = String(input ?? '').trim()
  if (!raw || raw.length > MAX_LENGTH || !/\d|pi|\be\b/i.test(raw)) return null
  // A date or a phone number written with dashes is not a subtraction.
  if (/^\d+(-\d+)+$/.test(raw)) return null
  try {
    const { tree, hasOperator } = parse(tokenize(raw))
    if (!hasOperator) return null
    const value = run(tree)
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    return { value, ...formatNumber(value) }
  } catch {
    return null
  }
}
