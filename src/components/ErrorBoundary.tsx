import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

/** Prevents a route crash from blanking the whole app. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI crash', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="page-shell mx-auto max-w-lg py-16 text-center">
        <p className="section-label mb-2">Bir şey ters gitti</p>
        <h1 className="font-display text-2xl font-semibold">Sayfa açılamadı</h1>
        <p className="muted mt-3 text-sm leading-relaxed">
          {this.state.error.message || 'Beklenmeyen bir hata'}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              this.setState({ error: null })
              window.location.assign('/')
            }}
          >
            Ana sayfaya dön
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => window.location.reload()}
          >
            Yenile
          </button>
        </div>
      </div>
    )
  }
}
