import { useEffect } from "react";

/* Holds keyboard focus inside an open dialog and restores it on close. */
export function useFocusTrap(ref, open, close) {
  useEffect(() => {
    if (!open) return undefined;
    const prior = document.activeElement;
    const keydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [
        ...(ref.current?.querySelectorAll(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [contenteditable="true"]',
        ) || []),
      ].filter((element) => element.getClientRects().length);
      if (!controls.length) return;
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    requestAnimationFrame(() => {
      const target =
        ref.current?.querySelector("[data-autofocus]") ||
        ref.current?.querySelector("input, textarea, button");
      target?.focus();
    });
    return () => {
      document.removeEventListener("keydown", keydown);
      prior?.focus?.();
    };
  }, [open, close, ref]);
}
