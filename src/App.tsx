import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import DashboardPage from './pages/DashboardPage'
import RecoveryPage from './pages/RecoveryPage'
import RunningPage from './pages/RunningPage'
import StrengthPage from './pages/StrengthPage'
import BodyPage from './pages/BodyPage'
import SettingsPage from './pages/SettingsPage'

// A signed-in visitor hitting `/` has no reason to see the marketing pitch —
// send them straight to their dashboard. A signed-out visitor gets the
// landing page. Mirrors ProtectedRoute's loading/authenticated/anonymous
// three-way branch so the two stay consistent, but inverted (landing page is
// the "anonymous" case here, not a redirect to /login).
function RootRoute() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-5 h-5 rounded-full border-2 border-gray-700 border-t-gray-300 animate-spin" />
      </div>
    )
  }

  return user ? <Navigate to="/dashboard" replace /> : <LandingPage />
}

export default function App() {
  return (
    <ThemeProvider>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/" element={<RootRoute />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/recovery" element={<RecoveryPage />} />
              <Route path="/running" element={<RunningPage />} />
              <Route path="/strength" element={<StrengthPage />} />
              <Route path="/body" element={<BodyPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ThemeProvider>
  )
}
