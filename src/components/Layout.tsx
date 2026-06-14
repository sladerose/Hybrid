import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/recovery', label: 'Recovery' },
  { to: '/running', label: 'Running' },
  { to: '/strength', label: 'Strength' },
  { to: '/body', label: 'Body' },
]

export default function Layout() {
  const { user, signOut } = useAuth()

  return (
    <div className="flex h-screen bg-gray-950 overflow-hidden">
      <aside className="w-48 shrink-0 flex flex-col border-r border-gray-800">
        <div className="px-5 h-14 flex items-center border-b border-gray-800">
          <span className="text-sm font-semibold text-white tracking-tight">slade.fit</span>
        </div>

        <nav className="flex-1 p-2 space-y-0.5">
          {NAV.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-gray-800 text-white font-medium'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-900'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 pb-4 pt-3 border-t border-gray-800">
          <p className="text-[11px] text-gray-600 truncate mb-2">{user?.email}</p>
          <button
            onClick={signOut}
            className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors cursor-pointer"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="px-6 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
