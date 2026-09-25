import { useEffect, useRef, useState } from "react";

/* A small anchored menu: `trigger` renders the button, `items` the choices.
   Items: { label, icon, onSelect, danger, disabled, checked, divider }. */
export function Menu({ trigger, items, align = "end", className = "", ariaLabel = "More actions" }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    // Native layers (the browser's page) step aside while any menu is open.
    document.documentElement.dataset.menu = "open";
    const close = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    const key = (event) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } };
    addEventListener("pointerdown", close, true);
    addEventListener("keydown", key, true);
    return () => { delete document.documentElement.dataset.menu; removeEventListener("pointerdown", close, true); removeEventListener("keydown", key, true); };
  }, [open]);
  return (
    <span className={`menu-root ${className}`} ref={root}>
      {trigger({ open, toggle: (event) => { event?.stopPropagation?.(); setOpen((value) => !value); }, ariaLabel })}
      {open && (
        <div className={`menu-popover align-${align}`} role="menu">
          {items.filter(Boolean).map((item, index) =>
            item.divider ? <hr key={`d${index}`} /> : (
              <button
                key={item.label}
                role="menuitem"
                type="button"
                className={`${item.danger ? "danger" : ""} ${item.checked ? "checked" : ""}`}
                disabled={item.disabled}
                onClick={(event) => { event.stopPropagation(); setOpen(false); item.onSelect?.(); }}
              >
                {item.icon && <item.icon />}
                <span>{item.label}</span>
                {item.hint && <small>{item.hint}</small>}
              </button>
            ),
          )}
        </div>
      )}
    </span>
  );
}
