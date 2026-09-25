/* Markdown → React elements. No HTML strings, so note text and model output
   can never inject markup. Understands what OSAT notes actually use: fences,
   headings, nested lists with task items, quotes, rules, tables, plus inline
   code/bold/italic/strike/links, [[wikilinks]] and #tags.

   Task items keep their source line so a click can flip `[ ]` in the note. */

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\n]+\*|(?<![A-Za-z0-9])_[^_\n]+_(?![A-Za-z0-9]))|(~~[^~\n]+~~)|(\[\[[^\]\n]+\]\])|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|((?:^|(?<=[^\p{L}\p{N}_/#-]))#[\p{L}\p{N}_-]*\p{L}[\p{L}\p{N}_-]*)/gu;

const safeHref = (url) => (/^(https?:|mailto:)/i.test(url) ? url : undefined);

export function inline(text, handlers = {}, keyPrefix = "i") {
  const nodes = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const [token, code, strong, em, strike, wiki, link, auto, tag] = match;
    const key = `${keyPrefix}-${index++}`;
    if (code) nodes.push(<code key={key}>{code.slice(1, -1)}</code>);
    else if (strong) nodes.push(<strong key={key}>{inline(strong.slice(2, -2), handlers, key)}</strong>);
    else if (em) nodes.push(<em key={key}>{inline(em.slice(1, -1), handlers, key)}</em>);
    else if (strike) nodes.push(<s key={key}>{inline(strike.slice(2, -2), handlers, key)}</s>);
    else if (wiki) {
      const body = wiki.slice(2, -2);
      const pipe = body.indexOf("|");
      const target = (pipe >= 0 ? body.slice(0, pipe) : body).split("#")[0].trim();
      const label = pipe >= 0 ? body.slice(pipe + 1) : body;
      nodes.push(
        handlers.onWikilink ? (
          <button type="button" key={key} className={`md-wikilink ${handlers.resolves && !handlers.resolves(target) ? "is-missing" : ""}`} onClick={() => handlers.onWikilink(target)}>
            {label}
          </button>
        ) : (
          <span key={key} className="md-wikilink">{label}</span>
        ),
      );
    } else if (link) {
      const split = link.indexOf("](");
      const label = link.slice(1, split);
      const href = safeHref(link.slice(split + 2, -1));
      nodes.push(href ? <a key={key} href={href} target="_blank" rel="noreferrer noopener">{label}</a> : label);
    } else if (auto) {
      nodes.push(<a key={key} href={auto} target="_blank" rel="noreferrer noopener">{auto}</a>);
    } else if (tag) {
      const name = tag.slice(1).toLowerCase();
      nodes.push(
        handlers.onTag ? (
          <button type="button" key={key} className="md-tag" onClick={() => handlers.onTag(name)}>{tag}</button>
        ) : (
          <span key={key} className="md-tag">{tag}</span>
        ),
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length ? nodes : text;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(\[([ xX])\]\s+)?(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^\s*([-*_])\s*(?:\1\s*){2,}$/;
const FENCE = /^\s*(`{3,}|~{3,})\s*(\S*)/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

const cells = (row) => row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((cell) => cell.trim());

const slug = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

/* Lists: consecutive list lines, nested by indentation. Returns [items, nextIndex]. */
function parseList(lines, start, baseIndent, handlers) {
  const items = [];
  let i = start;
  let ordered = null;
  while (i < lines.length) {
    const match = lines[i].match(LIST);
    if (!match) break;
    const indent = match[1].length;
    if (indent < baseIndent) break;
    if (indent > baseIndent && items.length) {
      const [children, next] = parseList(lines, i, indent, handlers);
      items[items.length - 1].children = children;
      i = next;
      continue;
    }
    if (ordered === null) ordered = /\d/.test(match[2]);
    items.push({ line: i, task: match[3] ? match[4].toLowerCase() === "x" : null, text: match[5], children: null });
    i += 1;
    // Lazy continuation: indented plain lines belong to the item.
    while (i < lines.length && lines[i].trim() && !LIST.test(lines[i]) && /^\s{2,}/.test(lines[i]) && !FENCE.test(lines[i])) {
      items[items.length - 1].text += ` ${lines[i].trim()}`;
      i += 1;
    }
  }
  return [{ ordered: Boolean(ordered), items }, i];
}

function renderList(list, handlers, key) {
  const Tag = list.ordered ? "ol" : "ul";
  return (
    <Tag key={key}>
      {list.items.map((item, index) => (
        <li key={index} className={item.task !== null ? `md-task ${item.task ? "is-done" : ""}` : undefined}>
          {item.task !== null && (
            <input
              type="checkbox"
              checked={item.task}
              disabled={!handlers.onToggleTask}
              aria-label={item.task ? "Mark as not done" : "Mark as done"}
              onChange={() => handlers.onToggleTask?.(item.line)}
            />
          )}
          <span>{inline(item.text, handlers, `${key}-${index}`)}</span>
          {item.children && renderList(item.children, handlers, `${key}-${index}c`)}
        </li>
      ))}
    </Tag>
  );
}

export function renderMarkdown(text, handlers = {}) {
  const lines = String(text ?? "").split("\n");
  const blocks = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(FENCE);
    if (fence) {
      const marker = fence[1];
      const body = [];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith(marker)) body.push(lines[i++]);
      i += 1;
      blocks.push(
        <pre key={key++} data-lang={fence[2] || undefined}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (!line.trim()) { i += 1; continue; }

    if (RULE.test(line)) { blocks.push(<hr key={key++} />); i += 1; continue; }

    const heading = line.match(HEADING);
    if (heading) {
      const level = heading[1].length;
      const Tag = `h${Math.min(6, level + (handlers.headingOffset ?? 0))}`;
      blocks.push(<Tag key={key++} id={handlers.headingIds ? `md-${slug(heading[2])}-${i}` : undefined} data-line={i}>{inline(heading[2], handlers, `h${key}`)}</Tag>);
      i += 1;
      continue;
    }

    if (line.includes("|") && TABLE_SEP.test(lines[i + 1] || "")) {
      const head = cells(line);
      const body = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) body.push(cells(lines[i++]));
      blocks.push(
        <div className="md-table" key={key++}>
          <table>
            <thead><tr>{head.map((cell, c) => <th key={c}>{inline(cell, handlers, `th${c}`)}</th>)}</tr></thead>
            <tbody>{body.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{inline(cell, handlers, `td${r}-${c}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && QUOTE.test(lines[i])) body.push(lines[i++].match(QUOTE)[1]);
      blocks.push(<blockquote key={key++}>{renderMarkdown(body.join("\n"), handlers)}</blockquote>);
      continue;
    }

    if (LIST.test(line)) {
      const [list, next] = parseList(lines, i, line.match(LIST)[1].length, handlers);
      blocks.push(renderList(list, handlers, `l${key++}`));
      i = next;
      continue;
    }

    const paragraph = [];
    while (
      i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !HEADING.test(lines[i]) &&
      !QUOTE.test(lines[i]) && !RULE.test(lines[i]) && !LIST.test(lines[i])
    ) paragraph.push(lines[i++]);
    const parts = [];
    paragraph.forEach((part, index) => {
      if (index) parts.push(/ {2,}$/.test(paragraph[index - 1]) ? <br key={`br${index}`} /> : " ");
      parts.push(...[].concat(inline(part.replace(/ {2,}$/, ""), handlers, `p${key}-${index}`)));
    });
    blocks.push(<p key={key++}>{parts}</p>);
  }

  return blocks;
}

export function Markdown({ text, className = "", ...handlers }) {
  return <div className={`md ${className}`.trim()}>{renderMarkdown(text, handlers)}</div>;
}
