// Replaces the identical inline spinner markup repeated at the top-level
// loading branch of every page.
export function LoadingSkeleton() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-5 h-5 rounded-full border-2 border-gray-200 dark:border-gray-700 border-t-gray-600 dark:border-t-gray-300 animate-spin" />
    </div>
  )
}
