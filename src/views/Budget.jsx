import { ArrowClockwise, ArrowDownLeft, ArrowUpRight, Bank, MagnifyingGlass, Plus, Trash, Wallet, Warning } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { cleanError } from "../assistant/useAi.js";
import { CATEGORIES } from "../../shared/bank-model.mjs";
import { CashFlow, SpendingCard } from "../money/Charts.jsx";
import { BillsCard } from "../money/Bills.jsx";
import { holdings, monthTotals, recategorize, setLimit, setNotBill } from "../money/money-model.js";
import { makeId } from "../lib/ui.js";
import { useUndoToast } from "../lib/UndoToast.jsx";
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
  const [only, setOnly] = useState(null);
  const [find, setFind] = useState("");
  const [bank, setBank] = useBank();
  const [toast, showUndo] = useUndoToast();
  // Removes one entry from a budget list at once; Undo puts it back where it was.
  function removeFrom(list, entry) {
    const at = workspace.budget[list].findIndex((item) => item.id === entry.id);
    commit((state) => ({ ...state, budget: { ...state.budget, [list]: state.budget[list].filter((item) => item.id !== entry.id) } }));
    showUndo(`Removed “${entry.label}”`, () => commit((state) => {
      const items = state.budget[list].filter((item) => item.id !== entry.id);
      items.splice(at, 0, entry);
      return { ...state, budget: { ...state.budget, [list]: items } };
    }));
  }
  const monthly = workspace.budget.transactions.filter((entry) => entry.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date));
  const words = find.trim().toLowerCase();
  const shown = monthly.filter((entry) => (!only || (entry.category || "General") === only) && (!words || `${entry.label} ${entry.category} ${entry.bank || ""}`.toLowerCase().includes(words)));
  const totals = monthTotals(workspace.budget.transactions, month);
  const held = holdings(bank?.items);
  const total = workspace.budget.transactions.reduce((sum, item) => sum + item.amountMinor, 0);
  const categories = [...new Set([...CATEGORIES, ...workspace.budget.transactions.map((entry) => entry.category).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
  // A budget and a category changed by hand: one Undo each, putting back what was there.
  function changeLimit(category, minor) {
    const before = workspace.budget.limits?.[category] || 0;
    if (before === minor) return;
    commit((state) => setLimit(state, category, minor));
    showUndo(minor ? `${category}: ${formatMinor(minor)} a month` : `No budget for ${category}`, () => commit((state) => setLimit(state, category, before)));
  }
  function notBill(bill) {
    commit((state) => setNotBill(state, bill.key, true));
    showUndo(`“${bill.label}” isn’t a bill`, () => commit((state) => setNotBill(state, bill.key, false)));
  }
  function changeCategory(entry, category) {
    commit((state) => recategorize(state, entry.id, category));
    showUndo(`“${entry.label}” is ${category} now`, () => commit((state) => recategorize(state, entry.id, entry.category)));
  }

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
          <h1>Money</h1>
          <p className="money-note">Your banks and what you keep by hand, in one place. It stays on this Mac.</p>
        </div>
        {held ? (
          <div className="money-balance">
            <span>In your banks</span>
            <strong>{formatMinor(held.cash)}</strong>
            {held.owed > 0 && <small>{formatMinor(held.owed)} owed on cards and loans</small>}
          </div>
        ) : (
          <div className="money-balance">
            <span>All-time recorded net</span>
            <strong>{formatMinor(total)}</strong>
            <small>{workspace.budget.transactions.length} entries</small>
          </div>
        )}
      </header>

      <BankCard state={bank} setState={setBank} />
      <BillsCard budget={workspace.budget} today={localDateKey()} onNotBill={notBill} onDeletePlan={(id) => removeFrom("recurring", workspace.budget.recurring.find((item) => item.id === id))} />

      <div className="money-period"><h2>This month</h2><input aria-label="Ledger month" type="month" value={month} onChange={(event) => setMonth(event.target.value || localDateKey().slice(0, 7))} /></div>
      <div className="money-overview"><article><ArrowDownLeft /><span>Money in</span><strong>{formatMinor(totals.in)}</strong></article><article><ArrowUpRight /><span>Money out</span><strong>{formatMinor(totals.out)}</strong></article><article><Wallet /><span>Left over</span><strong>{formatMinor(totals.net)}</strong></article></div>

      <SpendingCard transactions={workspace.budget.transactions} month={month} limits={workspace.budget.limits || {}} only={only} onPick={setOnly} onLimit={changeLimit} />
      <CashFlow transactions={workspace.budget.transactions} month={month} />

      <div className="money-toolbar">
        <button type="button" className="primary-button" onClick={() => setAdding((v) => !v)}>
          <Plus /> {adding ? "Close" : "Add entry"}
        </button>
        <button type="button" className="ghost-button" onClick={() => setShowImport((v) => !v)}>
          {showImport ? "Hide import" : "Import CSV"}
        </button>
        <label className="money-find">
          <MagnifyingGlass aria-hidden="true" />
          <input type="search" aria-label="Find an entry" placeholder="Find an entry" value={find} onChange={(event) => setFind(event.target.value)} />
        </label>
      </div>
      {only && <p className="money-quiet money-only">Showing {only} · <button type="button" className="money-link" onClick={() => setOnly(null)}>Show everything</button></p>}

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
        {shown.length ? (
          shown.map((entry) => (
            <article className="money-row" key={entry.id}>
              <div>
                <strong>{entry.label}</strong>
                <small>
                  {entry.date} ·{" "}
                  <select className="money-cat" aria-label={`Category of ${entry.label}`} value={entry.category} onChange={(event) => changeCategory(entry, event.target.value)}>
                    {(categories.includes(entry.category) ? categories : [entry.category, ...categories]).map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                  {entry.bank ? ` · ${entry.bank}` : ""}
                </small>
              </div>
              <b className={entry.amountMinor < 0 ? "negative" : "positive"}>{formatMinor(entry.amountMinor)}</b>
              <button
                className="icon-button"
                type="button"
                aria-label={`Delete ${entry.label}`}
                onClick={() => removeFrom("transactions", entry)}
              >
                <Trash />
              </button>
            </article>
          ))
        ) : (
          <p className="money-empty">{monthly.length ? "Nothing matches. Try other words, or Show everything." : "No entries for this month. Connect a bank, or start with one thing you spent or earned."}</p>
        )}
      </div>

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
      {toast}
    </section>
  );
}

/* Banks (Phase 87, desktop/bank.cjs through Plaid): paste the Plaid keys once, then Connect a bank opens Plaid's own
   page in the browser. Accounts and balances show here; entries land in the ledger, an hour at a time. Only in the
   Mac app. */
function useBank() {
  const bridge = window.osatBank;
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!bridge) return undefined;
    bridge.status().then(setState, () => {});
    return bridge.onChange(setState);
  }, [bridge]);
  return [state, setState];
}

function BankCard({ state, setState }) {
  const bridge = window.osatBank;
  const [problem, setProblem] = useState("");
  const [keys, setKeys] = useState({ id: "", secret: "" });
  const [leaving, setLeaving] = useState(null);
  if (!bridge || !state) return null;
  const act = (work) => { setProblem(""); return work().then(setState, (error) => setProblem(cleanError(error))); };
  const saveKeys = (event) => { event.preventDefault(); act(() => bridge.setKeys(keys.id, keys.secret)).then(() => setKeys({ id: "", secret: "" })); };
  const trouble = problem || state.problem;

  if (!state.keys) {
    return (
      <section className="money-banks" aria-label="Your banks">
        <header><Bank aria-hidden="true" /><div><h2>Connect your bank</h2><p>Your accounts, balances and spending come in by themselves, through Plaid. Paste your Plaid keys once (<a href="https://dashboard.plaid.com/developers/keys" target="_blank" rel="noreferrer">dashboard.plaid.com → Developers → Keys</a>); they go to your Mac’s Keychain.</p></div></header>
        <form className="money-keys" onSubmit={saveKeys}>
          <input aria-label="Plaid Client ID" placeholder="Client ID" autoComplete="off" spellCheck={false} value={keys.id} onChange={(event) => setKeys({ ...keys, id: event.target.value })} />
          <input aria-label="Plaid Secret" placeholder="Secret" type="password" autoComplete="off" value={keys.secret} onChange={(event) => setKeys({ ...keys, secret: event.target.value })} />
          <button className="primary-button" type="submit" disabled={!keys.id.trim() || !keys.secret.trim()}>Save keys</button>
        </form>
        <p className="money-quiet">Sandbox keys connect Plaid’s pretend banks (user_good / pass_good) so you can try it first.</p>
        {trouble && <p className="money-problem" role="alert"><Warning /> {trouble}</p>}
      </section>
    );
  }

  return (
    <section className="money-banks" aria-label="Your banks">
      <header>
        <Bank aria-hidden="true" />
        <div>
          <h2>Your banks{state.env === "sandbox" ? <small> · Practice banks (Sandbox)</small> : null}</h2>
          <p>{state.linking ? "Finish connecting in your browser. OSAT waits here." : state.busy ? "Bringing in what changed…" : state.last ? `Up to date ${new Date(state.last.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}. OSAT looks again every hour.` : "Each hour, OSAT brings in what changed."}</p>
        </div>
        <span className="money-banks-actions">
          {state.items.length > 0 && <button type="button" className="ghost-button" aria-label="Look again" disabled={state.busy || state.linking} onClick={() => act(bridge.sync)}><ArrowClockwise className={state.busy ? "is-spinning" : ""} /></button>}
          {state.linking
            ? <button type="button" className="ghost-button" onClick={() => act(bridge.cancel)}>Stop</button>
            : <button type="button" className="primary-button" disabled={state.busy} onClick={() => act(bridge.connect)}><Plus /> Connect a bank</button>}
        </span>
      </header>
      {state.items.map((item) => (
        <article className="money-bank" key={item.id}>
          <div className="money-bank-head">
            <strong>{item.bank}</strong>
            {leaving === item.id
              ? <span>Disconnect {item.bank}? What it brought stays. <button type="button" className="ghost-button" onClick={() => { setLeaving(null); act(() => bridge.disconnect(item.id)); }}>Disconnect</button> <button type="button" className="ghost-button" onClick={() => setLeaving(null)}>Keep</button></span>
              : <button type="button" className="money-link" onClick={() => setLeaving(item.id)}>Disconnect</button>}
          </div>
          {item.problem && <p className="money-problem"><Warning /> {item.problem}</p>}
          <ul>
            {item.accounts.map((account) => (
              <li key={account.id}><span>{account.name}{account.mask ? ` ••${account.mask}` : ""}</span><b>{account.balanceMinor === null ? "—" : formatMinor(account.balanceMinor)}</b></li>
            ))}
            {!item.accounts.length && <li><span>Gathering your accounts…</span></li>}
          </ul>
        </article>
      ))}
      {trouble && <p className="money-problem" role="alert"><Warning /> {trouble}</p>}
      {!state.items.length && !state.linking && <p className="money-quiet">Keys saved. Connect a bank to bring in your accounts.{" "}<button type="button" className="money-link" onClick={() => act(bridge.forgetKeys)}>Use other keys</button></p>}
    </section>
  );
}

