import { useAppStore } from './state/appStore'
import { About } from './ui/About'
import { SessionBrowser } from './ui/SessionBrowser'
import { LoadingScreen } from './ui/LoadingScreen'
import { Shell } from './ui/Shell'
import { Theatre } from './scene/Theatre'

export default function App() {
  const screen = useAppStore((s) => s.screen)
  const error = useAppStore((s) => s.error)
  const dismissError = useAppStore((s) => s.dismissError)

  return (
    <>
      {screen === 'browser' && <SessionBrowser />}
      {screen === 'loading' && <LoadingScreen />}
      {screen === 'theatre' && (
        <div className="theatre">
          <Theatre />
          <div className="theatre__vignette" aria-hidden="true" />
          <Shell />
        </div>
      )}
      <About />
      {error && (
        <div className="toast panel" role="alert">
          <span className="toast__title label">ACQUISITION FAILED</span>
          <span className="toast__msg mono">{error}</span>
          <button className="toast__close mono" onClick={dismissError}>
            DISMISS
          </button>
        </div>
      )}
    </>
  )
}
