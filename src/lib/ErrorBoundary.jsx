import { Component } from 'react'

/* One room or one Settings page that breaks says so calmly, in its own place, with a way forward; the rest of OSAT
   (the desk, the dock, other rooms) keeps working. Without this, one error blanked the whole desk (Oct 14 2026).
   `whole` wraps a window's whole page: it offers to start the page again, so a grey screen never traps anyone. */
export class ErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error(`OSAT: ${this.props.where || 'a room'} broke:`, error, info?.componentStack) }
  render() {
    if (!this.state.error) return this.props.children
    const whole = this.props.whole === true
    return (
      <div className={whole ? 'broke is-whole' : 'broke'} role="alert">
        <b>{this.props.where ? `${this.props.where} hit a problem.` : 'This hit a problem.'}</b>
        <span>Nothing was lost. {whole ? 'Start it again and carry on.' : 'Try again, or open something else.'}</span>
        <button type="button" className="outline-button" onClick={() => (whole ? window.location.reload() : this.setState({ error: null }))}>{whole ? 'Start again' : 'Try again'}</button>
      </div>
    )
  }
}
