import { ConversionState } from '../types'

interface Props {
  state: ConversionState
  onSelect: (type: ConversionState['inputType']) => void
}

const OPTIONS = [
  {
    id: 'snippet',
    label: 'Code Snippet',
    desc: 'Paste an HTML fragment',
    icon: '✂️',
    available: true,
  },
  {
    id: 'page',
    label: 'Single Page',
    desc: 'Convert one full HTML page',
    icon: '📄',
    available: true,
  },
  {
    id: 'full-site',
    label: 'Full Site',
    desc: 'Crawl and convert an entire website (requires backend — coming soon)',
    icon: '🌐',
    available: false,
  },
] as const

export const InputSelector = ({ state, onSelect }: Props) => {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">What are you converting?</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {OPTIONS.map((option) => (
          <button
            key={option.id}
            disabled={!option.available}
            onClick={() => onSelect(option.id)}
            className={`p-6 rounded-lg border-2 text-left transition ${
              state.inputType === option.id
                ? 'border-blue-500 bg-blue-50'
                : option.available
                  ? 'border-gray-200 hover:border-gray-300 bg-white'
                  : 'border-gray-100 bg-gray-50 cursor-not-allowed opacity-60'
            }`}
          >
            <div className="text-2xl mb-2">{option.icon}</div>
            <div className="font-semibold text-lg">{option.label}</div>
            <div className="text-sm text-gray-600 mt-2">{option.desc}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
