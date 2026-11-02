import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CaretLeft, MagnifyingGlass } from "@phosphor-icons/react";
import { useUndoToast } from "../lib/UndoToast.jsx";
import { ErrorBoundary } from "../lib/ErrorBoundary.jsx";
import { ClipboardPage, KeyboardPage, LauncherProvider, QuickLinksPage, QuickSearchPage, RingPage, SnippetsPage, WindowLayoutsPage } from "./settings/launcher.jsx";
import { AboutPage, AiPage, AppearancePage, BotsPage, DataPage, GeneralPage, PhonePage, ScansPage } from "./settings/osat-pages.jsx";
import { SETTINGS_GROUPS, SETTINGS_PAGES, pageById, sectionFor } from "./settings/pages.js";
import { QueryContext } from "./settings/parts.jsx";
import { ShortcutsPage } from "./settings/Shortcuts.jsx";
import { MousePage } from "./settings/mouse.jsx";
import { ScreenshotsPage } from "./settings/screenshots.jsx";
import { SoulPage } from "./settings/Soul.jsx";
import { AccountsPage } from "./settings/Accounts.jsx";
import "../styles/settings.css";

/* Settings (Phase 113, after Phase 13b's sidebar): a home of tiles, one for each page in four plain groups, with one
   search box over every row on every page (⌘F; Esc clears it). A tile opens its page across the room, groups of rows
   each with one control; "All settings" or Esc goes back. A link into Settings opens its page straight away; older
   names still land where they should (`sectionFor`: the menu-bar icon opens "general"). */

export { AiSizes } from "./settings/osat-pages.jsx";
export { sectionFor };

const PAGES = {
  general: GeneralPage,
  appearance: AppearancePage,
  ai: AiPage,
  soul: SoulPage,
  bots: BotsPage,
  accounts: AccountsPage,
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
  mouse: MousePage,
  screenshots: ScreenshotsPage,
};

export function SettingsView({ workspace, commit, storage, target, navigate }) {
  const [toast, showUndo] = useUndoToast();
  // null is Settings' home: every page as a tile (Phase 113). A link into Settings opens its page straight away.
  const [section, setSection] = useState(() => (target?.section ? sectionFor(target.section) : null));
  const [text, setText] = useState("");
  const [none, setNone] = useState(false);
  // ⌘F asked for the search box: it takes the keys the moment home is drawn.
  const [find, setFind] = useState(0);
  const root = useRef(null);
  const field = useRef(null);
  const main = useRef(null);
  useEffect(() => { if (target?.section) { setSection(sectionFor(target.section)); setText(""); } }, [target?.section, target?.at]);

  const query = useMemo(() => text.toLowerCase().split(/\s+/).filter(Boolean), [text]);
  const searching = query.length > 0;
  const go = (id) => { setSection(id); setText(""); main.current?.scrollTo?.(0, 0); };

  // ⌘F searches every setting (from a page, it goes home first). Esc on a page goes back home, once the page itself
  // has had its turn (an open detail closes first and stops it there).
  useEffect(() => {
    const onFind = (event) => {
      if (!root.current?.isConnected || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      setSection(null);
      setFind((count) => count + 1);
    };
    const onEscape = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented || !root.current?.querySelector(".settings-back")) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      go(null);
    };
    window.addEventListener("keydown", onFind, true);
    window.addEventListener("keydown", onEscape);
    return () => { window.removeEventListener("keydown", onFind, true); window.removeEventListener("keydown", onEscape); };
  }, []);

  useLayoutEffect(() => { if (find) { field.current?.focus(); field.current?.select(); } }, [find]);

  // A search that finds nothing says so, once the pages have drawn what they have.
  useEffect(() => {
    if (!searching) { setNone(false); return undefined; }
    const frame = requestAnimationFrame(() => setNone(!main.current?.querySelector(".setting-row, .settings-legacy, .short-row")));
    return () => cancelAnimationFrame(frame);
  }, [searching, text, section]);

  const body = (page) => {
    const PageBody = PAGES[page.id];
    return <ErrorBoundary key={page.id} where={page.label}><PageBody page={page} workspace={workspace} commit={commit} storage={storage} showUndo={showUndo} navigate={navigate} /></ErrorBoundary>;
  };
  const open = section && !searching ? pageById(section) : null;

  return (
    <div className="settings" ref={root} data-searching={searching || undefined} data-home={open ? undefined : ""}>
      <div className="settings-main scroll-fade" ref={main}>
        <QueryContext.Provider value={query}>
          <LauncherProvider showUndo={showUndo}>
            {open ? (
              <div className="settings-page" key={open.id}>
                <button type="button" className="settings-back" onClick={() => go(null)} title="Back to all settings  esc"><CaretLeft weight="bold" aria-hidden="true" /> All settings</button>
                {body(open)}
              </div>
            ) : (
              <div className="settings-home">
                <header className="settings-home-head">
                  <h1>Settings</h1>
                  <div className="settings-search">
                    <MagnifyingGlass aria-hidden="true" />
                    <input
                      ref={field}
                      type="search"
                      value={text}
                      placeholder="Search every setting…"
                      aria-label="Search settings"
                      spellCheck={false}
                      onChange={(event) => setText(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Escape" && text) { event.preventDefault(); event.stopPropagation(); setText(""); } }}
                    />
                    {!text && <kbd aria-hidden="true">⌘F</kbd>}
                  </div>
                </header>
                {searching ? (
                  <div className="settings-page" key="search">
                    {SETTINGS_PAGES.map(body)}
                    {none && <p className="settings-none" role="status">Nothing in Settings matches “{text.trim()}”.</p>}
                  </div>
                ) : (
                  <nav className="settings-nav" aria-label="Settings sections">
                    {SETTINGS_GROUPS.map((group) => (
                      <section key={group.id} className="settings-nav-group" aria-label={group.label}>
                        <h2>{group.label}</h2>
                        <div className="settings-tiles">
                          {SETTINGS_PAGES.filter((page) => page.group === group.id).map((page) => {
                            const Icon = page.icon;
                            return (
                              <button key={page.id} type="button" className="settings-tile" aria-label={page.label} aria-describedby={`set-${page.id}`} onClick={() => go(page.id)}>
                                <i aria-hidden="true" data-tint={page.tint}><Icon weight="fill" /></i>
                                <b aria-hidden="true">{page.label}</b>
                                <small id={`set-${page.id}`}>{page.blurb}</small>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </nav>
                )}
              </div>
            )}
          </LauncherProvider>
        </QueryContext.Provider>
      </div>
      {toast}
    </div>
  );
}
