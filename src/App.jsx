import { ErrorBoundary } from "./lib/ErrorBoundary.jsx";
import { Desk } from "./shell/Desk.jsx";
import { PhoneSurface } from "./surfaces/Phone.jsx";
import { QuickSearchSurface } from "./surfaces/QuickSearch.jsx";
import { RingSurface } from "./surfaces/RingSurface.jsx";

/* One desk for the Mac window, the iPhone app's pages, the quick bar (with Ask) and the ring. Each is wrapped so a
   break anywhere offers "Start again" instead of a blank window. */
export function App() {
  const surface = new URLSearchParams(window.location.search).get("surface");
  const Surface = surface === "phone" ? PhoneSurface : surface === "search" ? QuickSearchSurface : surface === "ring" ? RingSurface : Desk;
  return <ErrorBoundary whole where="OSAT"><Surface /></ErrorBoundary>;
}
