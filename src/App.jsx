import { Desk } from "./shell/Desk.jsx";
import { PhoneSurface } from "./surfaces/Phone.jsx";
import { QuickChatSurface } from "./surfaces/QuickChat.jsx";

/* One desk for the Mac window, the iPhone app's pages, and the quick chat. */
export function App() {
  const surface = new URLSearchParams(window.location.search).get("surface");
  if (surface === "phone") return <PhoneSurface />;
  if (surface === "chat") return <QuickChatSurface />;
  return <Desk />;
}
