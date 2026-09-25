import { ArrowRight } from "@phosphor-icons/react";
import { MODULES, CORE_NAV, TOOL_NAV, FOOT_NAV } from "../lib/modules.js";

export function MoreView({ navigate }) {
  return (
    <section className="module-grid more-page">
      <header className="more-heading">
        <h1>Your spaces.</h1>
        <p>A place for every part of your day.</p>
      </header>
      <div className="module-list">
        {[...new Map([...CORE_NAV, ...TOOL_NAV, ...MODULES, ...FOOT_NAV].filter((item) => item.id !== "More").map((item) => [item.id, item])).values()].map(({ id, label, icon: Icon, description }) => (
          <button key={id} type="button" onClick={() => navigate(id)}>
            <Icon />
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
            <ArrowRight />
          </button>
        ))}
      </div>
    </section>
  );
}
