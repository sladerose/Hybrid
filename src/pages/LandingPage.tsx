import { Link } from 'react-router-dom'
import { Card } from '../components/shared/Card'

const SIGNALS = [
  { label: 'Running', desc: 'Pace, cadence, laps', color: 'text-blue-500', bg: 'bg-blue-500/10' },
  { label: 'Recovery', desc: 'Sleep, RHR, stress', color: 'text-purple-500', bg: 'bg-purple-500/10' },
  { label: 'Strength', desc: 'Volume, progression', color: 'text-orange-500', bg: 'bg-orange-500/10' },
  { label: 'Body', desc: 'Weight, composition', color: 'text-green-500', bg: 'bg-green-500/10' },
] as const

const EXAMPLES = [
  'Sleep quality tanked, body battery never recovered, and the tempo run was garbage.',
  'RHR elevated five days running: do not race Saturday.',
] as const

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <header className="flex items-center justify-between px-4 sm:px-8 py-6 max-w-3xl mx-auto w-full">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Hybrid</h1>
          <p className="text-xs text-gray-500">Personal performance dashboard</p>
        </div>
        <Link
          to="/login"
          className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          Log in
        </Link>
      </header>

      <main className="flex-1 flex flex-col items-center px-4 sm:px-8 max-w-3xl mx-auto w-full">
        <div className="text-center mt-6 mb-10">
          <h2 className="text-2xl sm:text-3xl font-semibold text-gray-900 dark:text-white leading-tight">
            One dashboard for the athlete who runs, lifts, and sleeps well.
          </h2>
          <p className="text-sm sm:text-base text-gray-500 mt-3 max-w-xl mx-auto">
            Your Garmin data tells you what happened. Hybrid tells you why.
          </p>
          <Link
            to="/signup"
            className="inline-block mt-6 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-6 py-2.5 rounded-lg transition-colors cursor-pointer"
          >
            Sign up
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full mb-10">
          {SIGNALS.map((s) => (
            <Card key={s.label} className="text-center">
              <div className={`w-8 h-8 rounded-full mx-auto mb-2 flex items-center justify-center ${s.bg}`}>
                <div className={`w-3 h-3 rounded-full ${s.color.replace('text-', 'bg-')}`} />
              </div>
              <p className={`text-sm font-medium ${s.color}`}>{s.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.desc}</p>
            </Card>
          ))}
        </div>

        <div className="w-full space-y-2 mb-12">
          {EXAMPLES.map((example) => (
            <Card key={example}>
              <p className="text-sm text-gray-700 dark:text-gray-300">{example}</p>
            </Card>
          ))}
        </div>
      </main>

      <footer className="text-center px-4 pb-8">
        <p className="text-xs text-gray-500">
          Already have an account?{' '}
          <Link to="/login" className="text-blue-500 hover:text-blue-400">
            Log in
          </Link>
        </p>
      </footer>
    </div>
  )
}
