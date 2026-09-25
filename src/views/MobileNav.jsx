import { PRIMARY_NAV } from "../lib/modules.js";

const PRIMARY = new Set(PRIMARY_NAV.map((item) => item.id));

export function MobileNav({ view, navigate }) {
  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {PRIMARY_NAV.map(({ id, label, icon: Icon }) => {
        const active = id === "More" ? !PRIMARY.has(view) : view === id;
        return (
          <button key={id} type="button" className={`${active ? "active" : ""} ${id === "Capture" ? "mobile-new" : ""}`} aria-current={active ? "page" : undefined} onClick={() => navigate(id)}>
            <Icon weight={active || id === "Capture" ? "bold" : "regular"} />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
