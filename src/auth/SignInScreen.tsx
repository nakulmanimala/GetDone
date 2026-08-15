import { Check, TriangleAlert } from 'lucide-react'
import { startSignIn } from './session'

interface SignInScreenProps {
  allowedDomain: string
  error?: string | null
  onRetry?: () => void
  offline?: boolean
}

export function SignInScreen({ allowedDomain, error, onRetry, offline }: SignInScreenProps) {
  return (
    <div className="signin-shell">
      <main className="signin-card">
        <div className="brand-mark signin-mark"><Check size={22} strokeWidth={3} /></div>
        <h1>GetDone</h1>
        <p className="signin-sub">Your team's tasks, private to each person.</p>

        {error && (
          <div className="signin-error" role="alert">
            <TriangleAlert size={15} />
            <span>{error}</span>
          </div>
        )}

        {offline ? (
          <>
            <p className="signin-hint">The sign-in service is unreachable. It may still be starting up.</p>
            <button className="signin-button" onClick={onRetry}>Try again</button>
          </>
        ) : (
          <>
            <button className="signin-button" onClick={() => startSignIn()}>
              <GoogleMark />
              Continue with Google
            </button>
            <p className="signin-hint">
              Only <strong>@{allowedDomain}</strong> accounts can sign in. The first person to sign in
              becomes the workspace owner.
            </p>
          </>
        )}
      </main>
    </div>
  )
}

// Inline rather than fetched: the app must render with no third-party requests.
function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.1z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.6-3.9-12.3-9.1H4.3v5.7C7.9 41.1 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.7 28.1c-.4-1.3-.7-2.7-.7-4.1s.3-2.8.7-4.1v-5.7H4.3C2.8 17.1 2 20.4 2 24s.8 6.9 2.3 9.8l7.4-5.7z" />
      <path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.4 2 7.9 6.9 4.3 14.2l7.4 5.7c1.7-5.2 6.6-9.1 12.3-9.1z" />
    </svg>
  )
}
