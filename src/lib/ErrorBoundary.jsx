import { Component } from 'react'

/* One room or one Settings page that breaks says so calmly, in its own place, with a way forward; the rest of OSAT
   (the desk, the dock, other rooms) keeps working. Without this, one error blanked the whole desk (Oct 14 2026). */
export class ErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error(`OSAT: ${this.props.where || 'a room'} broke:`, error, info?.componentStack) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="broke" role="alert">
        <b>{this.props.where ? `${this.props.where} hit a problem.` : 'This hit a problem.'}</b>
        <span>Nothing was lost. Try again, or open something else.</span>
        <button type="button" className="outline-button" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    )
  }
}
