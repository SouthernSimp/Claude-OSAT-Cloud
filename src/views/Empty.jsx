import { ArrowRight } from "@phosphor-icons/react";
export function EmptyInline({ copy, action, onClick }) {
  return (
    <div className="empty-inline">
      <span>{copy}</span>
      {action && (
        <button type="button" onClick={onClick}>
          {action} <ArrowRight />
        </button>
      )}
    </div>
  );
}


export function EmptyPanel({ icon: Icon, title, copy, action, onClick }) {
  return (
    <div className="empty-panel">
      <Icon />
      <h2>{title}</h2>
      <p>{copy}</p>
      {action && (
        <button className="primary-button" type="button" onClick={onClick}>
          {action}
        </button>
      )}
    </div>
  );
}
