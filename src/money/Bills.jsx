import { Trash } from "@phosphor-icons/react";
import { formatMinor } from "../osat-data.js";
import { bills, billsPerMonth, daysUntil } from "./money-model.js";

const EVERY = { weekly: "every week", monthly: "every month", yearly: "every year" };
const DATE = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });

/* When a bill is next due, in plain words. */
export function dueWords(iso, today) {
  const days = daysUntil(iso, today);
  if (days < 0) return "any day now";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `${DATE.format(new Date(`${iso}T12:00`))} · in ${days} days`;
}

/* Bills & subscriptions (Phase 88): what charges again and again, found in the bank's entries, and the plans kept by
   hand, soonest first, with about what they come to in a month. "Not a bill" puts a found one away (with Undo); a
   plan is deleted the way it always was. */
export function BillsCard({ budget, today, onNotBill, onDeletePlan }) {
  const list = bills(budget.transactions, today, { ignore: budget.notBills || [], plans: budget.recurring });
  if (!list.length) return null;
  return (
    <section className="money-card money-bills" aria-label="Bills and subscriptions">
      <header>
        <h2>Bills & subscriptions</h2>
        <p>About {formatMinor(billsPerMonth(list))} a month</p>
      </header>
      <ul>
        {list.map((bill) => (
          <li key={bill.key}>
            <div>
              <strong>{bill.label}</strong>
              <small>{EVERY[bill.cadence]}{bill.from === "plan" ? " · your plan" : ""} · next {dueWords(bill.next, today)}</small>
            </div>
            <b>{formatMinor(bill.amountMinor)}</b>
            {bill.from === "plan"
              ? <button type="button" className="icon-button" aria-label={`Delete ${bill.label}`} onClick={() => onDeletePlan(bill.id)}><Trash /></button>
              : <button type="button" className="money-link" onClick={() => onNotBill(bill)}>Not a bill</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}
