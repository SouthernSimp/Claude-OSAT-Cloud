import { Desk } from "./shell/Desk.jsx";
import { PhoneSurface } from "./surfaces/Phone.jsx";
import { QuickChatSurface } from "./surfaces/QuickChat.jsx";
import { QuickSearchSurface } from "./surfaces/QuickSearch.jsx";
import { RingSurface } from "./surfaces/RingSurface.jsx";

/* One desk for the Mac window, the iPhone app's pages, the quick chat and the quick search. */
export function App() {
  const surface = new URLSearchParams(window.location.search).get("surface");
  if (surface === "phone") return <PhoneSurface />;
  if (surface === "chat") return <QuickChatSurface />;
  if (surface === "search") return <QuickSearchSurface />;
  if (surface === "ring") return <RingSurface />;
  return <Desk />;
}
