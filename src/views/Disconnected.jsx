export function DisconnectedView({ title, icon: Icon, copy }) {
  return (
    <section className="connection-gate">
      <div>
        <Icon />
        <span>CONNECTION INACTIVE</span>
      </div>
      <h2>{title} is deliberately disconnected.</h2>
      <p>{copy}</p>
      <button className="outline-button" type="button" disabled>
        Connect after security review
      </button>
      <small>No token has been requested or stored.</small>
    </section>
  );
}
