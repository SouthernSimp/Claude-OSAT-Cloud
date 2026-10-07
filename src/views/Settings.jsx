import { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { useUndoToast } from "../lib/UndoToast.jsx";
import { ClipboardPage, KeyboardPage, LauncherProvider, QuickLinksPage, QuickSearchPage, RingPage, SnippetsPage, WindowLayoutsPage } from "./settings/launcher.jsx";
import { AboutPage, AiPage, AppearancePage, BotsPage, DataPage, GeneralPage, PhonePage, ScansPage } from "./settings/osat-pages.jsx";
import { SETTINGS_GROUPS, SETTINGS_PAGES, pageById, sectionFor } from "./settings/pages.js";
import { QueryContext } from "./settings/parts.jsx";
import { ShortcutsPage } from "./settings/Shortcuts.jsx";
import { ScreenshotsPage } from "./settings/screenshots.jsx";
import "../styles/settings.css";

/* Settings (Phase 13b), in Raycast's shape: a sidebar with a search box and one page for each thing, and on the right
   groups of rows, each a bold title with a grey line and its one control. The search box narrows every row on every
   page by its title and its line (⌘F, and Esc clears it). Older names for a page still land where they should
   (`sectionFor`: the menu-bar icon opens "general", Tools → Appearance opens "appearance"). */

export { AiSizes } from "./settings/osat-pages.jsx";
export { sectionFor };

const PAGES = {
  general: GeneralPage,
  appearance: AppearancePage,
  ai: AiPage,
  bots: BotsPage,
  data: DataPage,
  scans: ScansPage,
  iphone: PhonePage,
  about: AboutPage,
  "quick-search": QuickSearchPage,
  shortcuts: ShortcutsPage,
  keyboard: KeyboardPage,
  clipboard: ClipboardPage,
  "quick-links": QuickLinksPage,
  snippets: SnippetsPage,
  windows: WindowLayoutsPage,
  ring: RingPage,
  screenshots: ScreenshotsPage,
};

export function SettingsView({ workspace, commit, storage, target }) {
  const [toast, showUndo] = useUndoToast();
  const [section, setSection] = useState(() => sectionFor(target?.section));
  const [text, setText] = useState("");
  const [none, setNone] = useState(false);
  const root = useRef(null);
  const field = useRef(null);
  const main = useRef(null);
  useEffect(() => { if (target?.section) { setSection(sectionFor(target.section)); setText(""); } }, [target]);

  const query = useMemo(() => text.toLowerCase().split(/\s+/).filter(Boolean), [text]);
  const searching = query.length > 0;

  // ⌘F searches these settings while they are open in front.
  useEffect(() => {
    const onKey = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "f") return;
      const pop = root.current?.closest(".popout");
      if (!root.current?.isConnected || (pop && !pop.classList.contains("is-top"))) return;
      event.preventDefault();
      field.current?.focus();
      field.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A search that finds nothing says so, once the pages have drawn what they have.
  useEffect(() => {
    if (!searching) { setNone(false); return undefined; }
    const frame = requestAnimationFrame(() => setNone(!main.current?.querySelector(".setting-row, .settings-legacy, .short-row")));
    return () => cancelAnimationFrame(frame);
  }, [searching, text, section]);

  const go = (id) => { setSection(id); setText(""); main.current?.scrollTo?.(0, 0); };
  const shown = searching ? SETTINGS_PAGES : [pageById(section)];

  return (
    <div className="settings" ref={root} data-searching={searching || undefined}>
      <aside className="settings-rail">
        <div className="settings-search">
          <MagnifyingGlass aria-hidden="true" />
          <input
            ref={field}
            type="search"
            value={text}
            placeholder="Search settings…"
            aria-label="Search settings"
            spellCheck={false}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape" && text) { event.preventDefault(); setText(""); } }}
          />
          {!text && <kbd aria-hidden="true">⌘F</kbd>}
        </div>
        <nav className="settings-nav" aria-label="Settings sections">
          {SETTINGS_GROUPS.map((group) => (
            <div key={group.id} className="settings-nav-group">
              {group.label && <h3>{group.label}</h3>}
              {SETTINGS_PAGES.filter((page) => page.group === group.id).map((page) => {
                const Icon = page.icon;
                const on = !searching && section === page.id;
                return (
                  <button key={page.id} type="button" aria-current={on ? "page" : undefined} onClick={() => go(page.id)}>
                    <i aria-hidden="true"><Icon weight={on ? "fill" : "regular"} /></i>
                    <span>{page.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
      <div className="settings-main" ref={main}>
        <QueryContext.Provider value={query}>
          <LauncherProvider showUndo={showUndo}>
            <div className="settings-page" key={searching ? "search" : section}>
              {shown.map((page) => {
                const PageBody = PAGES[page.id];
                return <PageBody key={page.id} page={page} workspace={workspace} commit={commit} storage={storage} showUndo={showUndo} />;
              })}
              {searching && none && <p className="settings-none" role="status">Nothing in Settings matches “{text.trim()}”.</p>}
            </div>
          </LauncherProvider>
        </QueryContext.Provider>
      </div>
      {toast}
    </div>
  );
}
