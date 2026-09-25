import { memo } from "react";
import { anchor, arrowPoints, wirePath } from "../board-model.js";

/* Connections between cards, drawn in world space. `links` are the board's
   own wires; `wikis` are [[links]] between notes on this board (dashed). */
export const Wires = memo(function Wires({ cards, links, wikis, selectedLink, draft, onSelectLink, onLabelLink }) {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const drawn = links.flatMap((link) => {
    const a = byId.get(link.a), b = byId.get(link.b);
    if (!a || !b) return [];
    const path = wirePath(anchor(a, b), anchor(b, a));
    return [{ link, path }];
  });
  const linked = new Set(links.map((link) => [link.a, link.b].sort().join("|")));
  const wikiDrawn = wikis.flatMap((pair) => {
    const a = byId.get(pair.a), b = byId.get(pair.b);
    if (!a || !b || linked.has([pair.a, pair.b].sort().join("|"))) return [];
    return [{ pair, path: wirePath(anchor(a, b), anchor(b, a)) }];
  });
  let draftPath = null;
  if (draft) {
    const a = byId.get(draft.from);
    if (a) {
      const target = draft.to ? byId.get(draft.to) : null;
      const from = anchor(a, target || { x: draft.point.x - 1, y: draft.point.y - 1, w: 2, h: 2 });
      const to = target ? anchor(target, a) : { x: draft.point.x, y: draft.point.y, nx: 0, ny: 0 };
      draftPath = wirePath(from, to);
    }
  }
  return (
    <svg className="wires" width="1" height="1" aria-hidden="true">
      {wikiDrawn.map(({ pair, path }) => (
        <path key={`w-${pair.a}-${pair.b}`} className="wire-wiki" d={path.d} />
      ))}
      {drawn.map(({ link, path }) => (
        <g key={link.id} className={`wire ${selectedLink === link.id ? "is-sel" : ""}`} data-link={link.id}>
          <path className="wire-hit" d={path.d} onPointerDown={(event) => { event.stopPropagation(); onSelectLink(link.id); }} onDoubleClick={() => onLabelLink(link.id)} />
          <path className="wire-line" d={path.d} />
          {link.arrow && <polygon className="wire-arrow" points={arrowPoints(path.tip, path.tan)} />}
          {link.label && (
            <text className="wire-label" x={path.mid.x} y={path.mid.y} textAnchor="middle" onPointerDown={(event) => { event.stopPropagation(); onSelectLink(link.id); }} onDoubleClick={() => onLabelLink(link.id)}>
              {link.label}
            </text>
          )}
        </g>
      ))}
      {draftPath && <path className="wire-draft" d={draftPath.d} />}
    </svg>
  );
});
