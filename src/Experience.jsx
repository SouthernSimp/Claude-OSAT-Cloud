import { useEffect, useRef, useState } from "react";
import { Aperture, Pause, Play, X } from "@phosphor-icons/react";
import { focusRemaining, startFocusSession, pauseFocusSession, resumeFocusSession } from "./focus-session.js";
import { useFocusTrap } from "./lib/use-focus-trap.js";

export function FocusEnvironment({ session, onChange, close, task }) {
  const [now, setNow] = useState(Date.now()); const [finished, setFinished] = useState(false); const dialog = useRef(null);
  useEffect(() => { const previous = document.activeElement; dialog.current?.focus(); const timer = setInterval(() => setNow(Date.now()), 1000); const key = (event) => { if (event.key === "Escape") close(); }; window.addEventListener("keydown", key); return () => { clearInterval(timer); window.removeEventListener("keydown", key); previous?.focus(); }; }, []);
  useFocusTrap(dialog, true, close);
  const remaining = focusRemaining(session, now); useEffect(() => { if (session.status === "running" && remaining <= 0) { setFinished(true); onChange({ status: "idle" }); } }, [remaining, session.status]);
  const minutes = Math.floor(remaining / 60000), seconds = Math.floor((remaining % 60000) / 1000); const start = () => { setFinished(false); setNow(Date.now()); onChange(session.status === "paused" ? resumeFocusSession(session) : startFocusSession()); };
  return <div className="focus-environment" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Focus session"><img src="./images/focus-landscape.png" alt="" /><div className="focus-environment-shade" /><header><span><Aperture /> OSAT <small>FOCUS</small></span><button onClick={close}><X /> Return to workspace</button></header><div className="focus-environment-center"><p>{finished ? "A little further than before." : "Nothing else needs you right now."}</p><h2>{finished ? "Well done." : task || "Make room for your best work."}</h2><div className={`focus-time ${session.status === "running" ? "is-running" : ""}`}><span>{String(minutes).padStart(2, "0")}<i>:</i>{String(seconds).padStart(2, "0")}</span></div><div className="focus-environment-actions">{session.status === "running" ? <button onClick={() => onChange(pauseFocusSession(session))}><Pause weight="fill" />Pause session</button> : <button onClick={start}><Play weight="fill" />{session.status === "paused" ? "Resume session" : finished ? "Another quiet moment" : "Begin 25 minutes"}</button>}{session.status !== "idle" && <button className="focus-end" onClick={() => { onChange({ status: "idle" }); close(); }}>End session</button>}</div></div></div>;
}
