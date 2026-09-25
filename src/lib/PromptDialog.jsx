import { useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { useFocusTrap } from "./use-focus-trap.js";

/* A small modal prompt: { title, label, value, hint, confirm, onSubmit, onClose }. */
export function PromptDialog({ title, label = "Name", value = "", hint, confirm = "Save", danger = false, onSubmit, onClose }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);
  useFocusTrap(ref, true, onClose);
  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <form
        ref={ref}
        className="prompt-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-title"
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => { event.preventDefault(); onSubmit(draft.trim()); }}
      >
        <button className="icon-button modal-close" type="button" aria-label="Close" onClick={onClose}><X /></button>
        <h2 id="prompt-title">{title}</h2>
        <label>
          {label}
          <input data-autofocus value={draft} maxLength={80} onChange={(event) => setDraft(event.target.value)} onFocus={(event) => event.target.select()} />
        </label>
        {hint && <p>{hint}</p>}
        <div className="dialog-actions">
          <span />
          <span className="dialog-buttons">
            <button type="button" className="ghost-button" onClick={onClose}>Cancel</button>
            <button type="submit" className={danger ? "danger-button outline-button" : "primary-button"}>{confirm}</button>
          </span>
        </div>
      </form>
    </div>
  );
}
