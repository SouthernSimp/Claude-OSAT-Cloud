import { Plus, Trash } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { makeId } from "../lib/ui.js";
import { formatMinor } from "../osat-data.js";
import { payoff, readLimit, readRate, worth } from "./money-model.js";

const blank = (owe) => ({ owe, label: "", amount: "", rate: "", minimum: "" });

/* What you have and owe (Phase 100, Nate's sticky: "budget should use a questioning system 1. What do you currently
   have 2. What are your current debts"). Two plain questions, one after the other; then both sides listed with the
   connected banks' totals first, your net worth (below zero is a plain number), and one line on paying debts down.
   A row opens in the same form; the trash takes it off with the room's Undo. Esc closes a question. */
export function WorthCard({ balances = [], held, commit, onRemove, start = false, onClose }) {
  const [form, setForm] = useState(() => (start ? blank(false) : null));
  const [bad, setBad] = useState(false);
  const name = useRef(null);
  const sum = worth(held, balances);
  const plan = payoff(balances);
  const least = plan?.leastMinor ? `Pay at least ${formatMinor(plan.leastMinor)} a month` : "";
  const extra = plan?.first ? `${least ? ", and anything more" : "Pay anything extra"} to ${plan.first.label} first: at ${plan.first.rate}% it costs the most` : "";
  const close = () => { setForm(null); setBad(false); onClose?.(); };
  const edit = (item) => { setBad(false); setForm({ owe: item.owe, id: item.id, label: item.label, amount: String(item.amountMinor / 100), rate: item.rate ? String(item.rate) : "", minimum: item.minimumMinor ? String(item.minimumMinor / 100) : "" }); };

  // Keeps what is typed (a new row, or the row being changed); false when it doesn't read, so nothing typed is lost.
  function keep() {
    const amountMinor = form.amount.trim() ? readLimit(form.amount) : null;
    const rate = form.owe ? readRate(form.rate) : 0;
    const minimumMinor = form.owe ? readLimit(form.minimum) : 0;
    if (!form.label.trim() || amountMinor === null || rate === null || minimumMinor === null) { setBad(true); return false; }
    const item = { id: form.id || makeId("balance"), label: form.label.trim().slice(0, 60), owe: form.owe, amountMinor, ...(rate ? { rate } : {}), ...(minimumMinor ? { minimumMinor } : {}) };
    commit((state) => {
      const list = state.budget.balances || [];
      return { ...state, budget: { ...state.budget, balances: form.id ? list.map((one) => (one.id === form.id ? item : one)) : [...list, item] } };
    });
    setBad(false);
    return true;
  }
  // Next and Done keep anything typed first.
  const typed = () => [form.label, form.amount, form.rate, form.minimum].some((value) => value.trim());
  const onward = () => { if (typed() && !keep()) return; if (form.owe) close(); else setForm(blank(true)); };

  const rows = (owe) => [
    ...(held && (!owe || held.owed > 0) ? [
      <li key="banks"><div><strong>{owe ? "Cards and loans at your banks" : "In your banks"}</strong></div><b>{formatMinor(owe ? held.owed : held.cash)}</b></li>,
    ] : []),
    ...balances.filter((item) => item.owe === owe).map((item) => (
      <li key={item.id}>
        <button type="button" onClick={() => edit(item)}>
          <strong>{item.label}</strong>
          {item.rate || item.minimumMinor ? <small>{[item.rate && `${item.rate}%`, item.minimumMinor && `at least ${formatMinor(item.minimumMinor)} a month`].filter(Boolean).join(" · ")}</small> : null}
        </button>
        <b>{formatMinor(item.amountMinor)}</b>
        <button type="button" className="icon-button" aria-label={`Delete ${item.label}`} onClick={() => onRemove(item)}><Trash /></button>
      </li>
    )),
  ];
  const have = rows(false);
  const owe = rows(true);

  return (
    <section className="money-card money-bills money-worth" aria-label="What you have and owe">
      <header>
        <h2>What you have and owe</h2>
        {!form && <button type="button" className="outline-button" onClick={() => setForm(blank(false))}><Plus /> Add</button>}
      </header>
      {form && (
        <form
          key={form.id || String(form.owe)}
          className="money-composer"
          aria-label={form.owe ? "What do you owe?" : "What do you have?"}
          onSubmit={(event) => { event.preventDefault(); if (!keep()) return; if (form.id) close(); else { setForm(blank(form.owe)); name.current?.focus(); } }}
          onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}
        >
          <h3>{form.owe ? "What do you owe?" : "What do you have?"}</h3>
          <p className="money-quiet">{form.owe ? "Loans, and cards your banks don’t show." : "Cash, and accounts your banks don’t show."}</p>
          <input ref={name} autoFocus aria-label="Name" placeholder="Name" value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} />
          <input aria-label={form.owe ? "Owed" : "Amount"} inputMode="decimal" placeholder={form.owe ? "Owed" : "Amount"} value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
          {form.owe && <input aria-label="Rate %" inputMode="decimal" placeholder="Rate %" value={form.rate} onChange={(event) => setForm({ ...form, rate: event.target.value })} />}
          {form.owe && <input aria-label="Least a month" inputMode="decimal" placeholder="Least a month" value={form.minimum} onChange={(event) => setForm({ ...form, minimum: event.target.value })} />}
          {bad && <p className="form-error" role="alert">Add a name and an amount like 1,250.00{form.owe ? ", and a rate from 0 to 100" : ""}.</p>}
          <div className="money-composer-actions">
            <button className="outline-button" type="submit">{form.id ? "Save" : <><Plus /> Add</>}</button>
            <button className="ghost-button" type="button" onClick={form.id ? close : onward}>{form.id ? "Cancel" : form.owe ? "Done" : "Next: what you owe"}</button>
          </div>
        </form>
      )}
      {sum ? (
        <div className="money-ledger">
          {have.length > 0 && <div className="money-day"><h3>You have</h3><ul>{have}</ul></div>}
          {owe.length > 0 && <div className="money-day"><h3>You owe</h3><ul>{owe}</ul></div>}
          <div className="money-balance">
            <span>Net worth</span>
            <strong>{formatMinor(sum.net)}</strong>
            {(least || extra) && <small>{least}{extra}.</small>}
          </div>
        </div>
      ) : !form && <p className="money-quiet">Cash, savings, a loan: say what you have and owe, and see your net worth.</p>}
    </section>
  );
}
