export default function BodyPage() {
  return (
    <div>
      <h1 className="text-base font-semibold text-white mb-1">Body Composition</h1>
      <p className="text-sm text-gray-500 mb-6">
        Weight trend, body fat, muscle mass, visceral fat, and metabolic age
      </p>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
        <p className="text-gray-500 text-sm">Awaiting Zepp sync</p>
        <p className="text-gray-700 text-xs mt-1">
          Data will appear once the Zepp MCP integration is live
        </p>
      </div>
    </div>
  )
}
