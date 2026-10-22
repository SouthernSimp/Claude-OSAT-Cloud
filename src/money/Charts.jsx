import { useState } from "react";
import { formatMinor } from "../osat-data.js";
import { arcs, cashFlow, readLimit, ringPath, spending } from "./money-model.js";

const SIZE = 220;
const MONTH = new Intl.DateTimeFormat("en-US", { month: "short" });
const monthName = (key) => MONTH.format(new Date(`${key}-15T12:00`));
const percent = (share) => `${share.toFixed(share >= 10 ? 0 : 1)}%`;

/* Spending by category (Phase 87): the month's money out as a donut of the five largest categories and everything
   else, beside the table of every category (its share, its amount, and its budget when one is set). Picking a
   category narrows the list of entries below; Set a budget is written right in the row. Colours follow the
   validated categorical palette (tokens in views.css); the table is always there, so colour never carries it alone. */
export function SpendingCard({ transactions, month, limits, only, onPick, onLimit }) {
  const { total, rows, slices } = spending(transactions, month, limits);
  const [hover, setHover] = useState(null);
  const [editing, setEditing] = useState(null);
  if (!total) return null;
  const slot = new Map(slices.flatMap((slice) => (slice.rest ? slice.rest.map((name) => [name, 0]) : [[slice.category, slice.slot]])));
  const lit = hover ?? slices.find((slice) => slice.category === only || slice.rest?.includes(only)) ?? null;

  return (
    <section className="money-card money-spending" aria-label="Spending by category">
      <header>
        <h2>Spending by category</h2>
        <p>{formatMinor(total)} out in {new Date(`${month}-15T12:00`).toLocaleDateString("en-US", { month: "long" })}. Transfers between your own accounts aren’t counted.</p>
      </header>
      <div className="money-spending-body">
        <table>
          <thead><tr><th scope="col">Category</th><th scope="col">% of total</th><th scope="col">Amount</th><th scope="col">Budget</th></tr></thead>
          <tbody>
            {rows.map((row) => {
              const over = row.limitMinor && row.spentMinor > row.limitMinor;
              return (
                <tr key={row.category} aria-current={only === row.category ? "true" : undefined}>
                  <th scope="row">
                    <button type="button" className="money-cat-pick" aria-pressed={only === row.category} onClick={() => onPick(only === row.category ? null : row.category)} onMouseEnter={() => setHover(slices.find((slice) => slice.category === row.category || slice.rest?.includes(row.category)))} onMouseLeave={() => setHover(null)}>
                      <i className="money-dot" data-slot={slot.get(row.category) ?? 0} aria-hidden="true" />{row.category}
                    </button>
                  </th>
                  <td>{percent(row.share)}</td>
                  <td>{formatMinor(row.spentMinor)}</td>
                  <td>
                    {editing === row.category
                      ? <LimitForm category={row.category} initial={row.limitMinor} onDone={(minor) => { setEditing(null); if (minor !== null) onLimit(row.category, minor); }} />
                      : row.limitMinor
                        ? (
                          <button type="button" className="money-limit" onClick={() => setEditing(row.category)} aria-label={`${row.category}: ${formatMinor(row.spentMinor)} of ${formatMinor(row.limitMinor)}${over ? ", over budget" : ""}. Change the budget`}>
                            <span className="money-meter" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.round((row.spentMinor / row.limitMinor) * 100))}%` }} data-over={over || undefined} /></span>
                            <small>{over ? `${formatMinor(row.spentMinor - row.limitMinor)} over` : `${formatMinor(row.limitMinor - row.spentMinor)} left`}</small>
                          </button>
                        )
                        : <button type="button" className="money-link" onClick={() => setEditing(row.category)}>Set a budget</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <figure className="money-donut" aria-hidden="true">
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE}>
            {arcs(slices).map((arc) => (
              <path
                key={arc.category}
                d={ringPath(arc, { size: SIZE, thickness: 30 })}
                fillRule="evenodd"
                data-slot={arc.slot}
                data-dim={lit && lit.category !== arc.category ? "" : undefined}
                onMouseEnter={() => setHover(arc)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onPick(arc.rest ? null : only === arc.category ? null : arc.category)}
              />
            ))}
          </svg>
          <figcaption>
            <small>{lit ? lit.category : "Total"}</small>
            <strong>{formatMinor(lit ? lit.spentMinor : total)}</strong>
            {lit && <small>{percent(lit.share)}</small>}
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

/* A budget written in place: Return keeps it, Esc lets it go, blank takes it off. */
function LimitForm({ category, initial, onDone }) {
  const [text, setText] = useState(initial ? String(initial / 100) : "");
  const [bad, setBad] = useState(false);
  const finish = () => { const minor = readLimit(text); if (minor === null) { setBad(true); return; } onDone(minor); };
  return (
    <form className="money-limit-form" onSubmit={(event) => { event.preventDefault(); finish(); }}>
      <input
        autoFocus
        inputMode="decimal"
        aria-label={`Monthly budget for ${category}`}
        aria-invalid={bad || undefined}
        placeholder="300"
        value={text}
        onChange={(event) => { setText(event.target.value); setBad(false); }}
        onBlur={finish}
        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onDone(null); } }}
      />
    </form>
  );
}

/* Cash flow (Phase 87): money in and money out for the last six months, side by side on one axis. Hovering a month
   shows both numbers and what was left. */
export function CashFlow({ transactions, month }) {
  const months = cashFlow(transactions, month);
  const [hover, setHover] = useState(null);
  const top = Math.max(...months.flatMap((row) => [row.in, row.out]));
  if (!top) return null;
  const height = 140;
  const bar = (value) => Math.max(value ? 2 : 0, Math.round((value / top) * height));
  const shown = hover === null ? null : months[hover];
  return (
    <section className="money-card money-flow" aria-label="Cash flow">
      <header>
        <h2>Cash flow</h2>
        <p className="money-legend"><span><i data-slot="1" />Money in</span><span><i data-slot="2" />Money out</span></p>
      </header>
      <div className="money-flow-plot" style={{ "--plot": `${height}px` }}>
        {months.map((row, index) => (
          <div
            key={row.month}
            className="money-flow-month"
            data-now={row.month === month || undefined}
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
            tabIndex={0}
            onFocus={() => setHover(index)}
            onBlur={() => setHover(null)}
            aria-label={`${monthName(row.month)}: ${formatMinor(row.in)} in, ${formatMinor(row.out)} out`}
          >
            <span className="money-flow-bars">
              <i data-slot="1" style={{ height: `${bar(row.in)}px` }} />
              <i data-slot="2" style={{ height: `${bar(row.out)}px` }} />
            </span>
            <small>{monthName(row.month)}</small>
          </div>
        ))}
        {shown && (
          <div className="money-tip" role="status" style={{ "--at": `${((hover + 0.5) / months.length) * 100}%` }}>
            <strong>{new Date(`${shown.month}-15T12:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</strong>
            <span><i data-slot="1" />In {formatMinor(shown.in)}</span>
            <span><i data-slot="2" />Out {formatMinor(shown.out)}</span>
            <span>Left {formatMinor(shown.in - shown.out)}</span>
          </div>
        )}
      </div>
    </section>
  );
}
