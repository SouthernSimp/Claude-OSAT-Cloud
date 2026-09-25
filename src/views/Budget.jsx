import { ArrowDownLeft, ArrowUpRight, Plus, Trash, Wallet } from "@phosphor-icons/react";
import { useState } from "react";
import { makeId } from "../lib/ui.js";
import { localDateKey } from "../daily-practice.js";
import { formatMinor, parseBudgetCsv, parseMoneyToMinor } from "../osat-data.js";

export function BudgetView({ workspace, commit }) {
  const [form, setForm] = useState({
    label: "",
    amount: "",
    category: "",
    date: localDateKey(),
    recurring: false,
    cadence: "monthly",
  });
  const [error, setError] = useState("");
  const [csv, setCsv] = useState("");
  const [review, setReview] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [adding, setAdding] = useState(false);
  const [month, setMonth] = useState(localDateKey().slice(0, 7));
  const monthly = workspace.budget.transactions.filter((entry) => entry.date.startsWith(month));
  const income = monthly.filter((entry) => entry.amountMinor > 0).reduce((sum, entry) => sum + entry.amountMinor, 0);
  const spending = monthly.filter((entry) => entry.amountMinor < 0).reduce((sum, entry) => sum - entry.amountMinor, 0);

  const total = workspace.budget.transactions.reduce((sum, item) => sum + item.amountMinor, 0);

  function save(event) {
    event.preventDefault();
    const amountMinor = parseMoneyToMinor(form.amount);
    if (!form.label.trim() || amountMinor === null) {
      setError("Add a description and an amount like -12.50.");
      return;
    }
    const entry = {
      id: makeId(form.recurring ? "recurring" : "transaction"),
      label: form.label.trim(),
      amountMinor,
      category: form.category.trim() || "General",
      date: form.date,
      ...(form.recurring ? { cadence: form.cadence } : {}),
    };
    commit((state) => ({
      ...state,
      budget: {
        ...state.budget,
        [form.recurring ? "recurring" : "transactions"]: [
          entry,
          ...state.budget[form.recurring ? "recurring" : "transactions"],
        ],
      },
    }));
    setForm({ label: "", amount: "", category: "", date: localDateKey(), recurring: false, cadence: "monthly" });
    setError("");
    setAdding(false);
  }

  function reviewCsv() { setReview(parseBudgetCsv(csv)); }
  function importCsv() {
    if (!review?.rows.length || review.errors.length) return;
    commit((state) => ({
      ...state,
      budget: { ...state.budget, transactions: [...review.rows, ...state.budget.transactions] },
    }));
    setCsv("");
    setReview(null);
    setShowImport(false);
  }

  return (
    <section className="money-page">
      <header className="money-hero">
        <div>
          <p className="money-kicker">A LITTLE FINANCIAL CLARITY</p>
          <h1>Room to feel on top of it.</h1>
          <p className="money-note">Your spending, your plans, a little less guesswork. A private manual ledger.</p>
        </div>
        <div className="money-balance">
          <span>All-time recorded net</span>
          <strong>{formatMinor(total)}</strong>
          <small>{workspace.budget.transactions.length} entries</small>
        </div>
      </header>

      <div className="money-period"><h2>A look at the month</h2><input aria-label="Ledger month" type="month" value={month} onChange={(event) => setMonth(event.target.value || localDateKey().slice(0, 7))} /></div>
      <div className="money-overview"><article><ArrowDownLeft /><span>Money in</span><strong>{formatMinor(income)}</strong></article><article><ArrowUpRight /><span>Money out</span><strong>{formatMinor(spending)}</strong></article><article><Wallet /><span>Recorded net</span><strong>{formatMinor(income - spending)}</strong></article></div>

      <div className="money-toolbar">
        <button type="button" className="primary-button" onClick={() => setAdding((v) => !v)}>
          <Plus /> {adding ? "Close" : "Add entry"}
        </button>
        <button type="button" className="ghost-button" onClick={() => setShowImport((v) => !v)}>
          {showImport ? "Hide import" : "Import CSV"}
        </button>
      </div>

      {adding ? (
        <form className="money-composer" onSubmit={save}>
          <input aria-label="Description" placeholder="Description" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <input aria-label="Amount" inputMode="decimal" placeholder="-12.50" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <input aria-label="Category" placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <input aria-label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <label className="check-row">
            <input type="checkbox" checked={form.recurring} onChange={(e) => setForm({ ...form, recurring: e.target.checked })} />
            Recurring plan
          </label>
          {form.recurring ? (
            <select value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value })}>
              <option value="weekly">weekly</option>
              <option value="monthly">monthly</option>
              <option value="yearly">yearly</option>
            </select>
          ) : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="primary-button" type="submit">Save entry</button>
        </form>
      ) : null}

      <div className="money-ledger">
        {monthly.length ? (
          monthly.map((entry) => (
            <article className="money-row" key={entry.id}>
              <div>
                <strong>{entry.label}</strong>
                <small>{entry.date} · {entry.category}</small>
              </div>
              <b className={entry.amountMinor < 0 ? "negative" : "positive"}>{formatMinor(entry.amountMinor)}</b>
              <button
                className="icon-button"
                type="button"
                aria-label={`Delete ${entry.label}`}
                onClick={() =>
                  commit((state) => ({
                    ...state,
                    budget: {
                      ...state.budget,
                      transactions: state.budget.transactions.filter((item) => item.id !== entry.id),
                    },
                  }))
                }
              >
                <Trash />
              </button>
            </article>
          ))
        ) : (
          <p className="money-empty">No entries for this month. Start with one thing you spent or earned.</p>
        )}
      </div>

      {workspace.budget.recurring.length > 0 ? (
        <div className="money-plans">
          <h2>Plans</h2>
          {workspace.budget.recurring.map((item) => (
            <div className="money-plan-row" key={item.id}>
              <span>{item.label} · {formatMinor(item.amountMinor)} · {item.cadence}</span>
              <button
                className="icon-button"
                type="button"
                aria-label={`Delete ${item.label}`}
                onClick={() =>
                  commit((state) => ({
                    ...state,
                    budget: {
                      ...state.budget,
                      recurring: state.budget.recurring.filter((entry) => entry.id !== item.id),
                    },
                  }))
                }
              >
                <Trash />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {showImport ? (
        <section className="money-import">
          <h2>Import CSV</h2>
          <p>Headers: date, label or description, amount. Category optional. Review before confirming.</p>
          <textarea
            rows="5"
            value={csv}
            onChange={(e) => { setCsv(e.target.value); setReview(null); }}
            placeholder={"date,label,amount,category\n2026-08-31,Software,-29.00,Tools"}
          />
          {review ? (
            <div className={`csv-result ${review.errors.length ? "blocked" : "ready"}`}>
              <strong>{review.rows.length} valid rows</strong>
              {review.errors.map((item) => <p key={item}>{item}</p>)}
            </div>
          ) : null}
          <div className="row-actions">
            <button type="button" onClick={reviewCsv} disabled={!csv.trim()}>Review</button>
            <button className="primary-button" type="button" onClick={importCsv} disabled={!review?.rows.length || review.errors.length}>
              Confirm import
            </button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
