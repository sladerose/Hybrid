import { useTheme } from '../context/ThemeContext'

export function useChartTheme() {
  const { theme } = useTheme()
  const dark = theme === 'dark'

  return {
    TIP: {
      backgroundColor: dark ? '#111827' : '#ffffff',
      border: `1px solid ${dark ? '#374151' : '#e5e7eb'}`,
      borderRadius: '8px',
      fontSize: 12,
      color: dark ? '#f9fafb' : '#111827',
    },
    GRID: dark ? '#1f2937' : '#e5e7eb',
    TICK: { fontSize: 10, fill: dark ? '#6b7280' : '#9ca3af' },
    LABEL_FILL: dark ? '#6b7280' : '#9ca3af',
    CURSOR_FILL: dark ? '#1f2937' : '#f3f4f6',
    LEGEND_FILL: dark ? '#9ca3af' : '#6b7280',
  }
}
