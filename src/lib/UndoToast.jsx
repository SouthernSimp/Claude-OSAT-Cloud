import { useCallback, useEffect, useState } from "react";

/* Calm rule 2: removing happens at once, and Undo is right there for a few seconds.
   const [toast, showUndo] = useUndoToast(); showUndo("Moved to Trash", () => …); render {toast}. */
export function useUndoToast() {
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  const show = useCallback((message, undo) => setToast({ id: Date.now(), message, undo }), []);
  const element = (
    <div className="undo-toasts" aria-live="polite">
      {toast && (
        <div className="toast" key={toast.id}>
          <span>{toast.message}</span>
          <button type="button" onClick={() => { toast.undo(); setToast(null); }}>Undo</button>
        </div>
      )}
    </div>
  );
  return [element, show];
}
