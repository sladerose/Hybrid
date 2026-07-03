export function ChartHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <p className="text-[10px] font-medium text-gray-500 uppercase tracking-widest">{title}</p>
      {sub && <p className="text-[11px] text-gray-500 dark:text-gray-600 mt-0.5">{sub}</p>}
    </div>
  )
}
