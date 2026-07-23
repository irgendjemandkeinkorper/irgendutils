import { useMemo, useState } from 'react'
import { ConversionResult } from '../types'
import { applyResolutions } from '../services/converter'
import { WpExporter } from '../services/wpExporter'

interface Props {
  result: ConversionResult
  onBack: () => void
  onStartOver: () => void
}

export const ExportOptions = ({ result, onBack, onStartOver }: Props) => {
  const [copied, setCopied] = useState<string | null>(null)
  const [previewTab, setPreviewTab] = useState<'json' | 'html'>('html')

  const exporter = useMemo(() => new WpExporter(), [])
  const finalBlocks = useMemo(() => applyResolutions(result), [result])
  const preview = useMemo(
    () =>
      previewTab === 'json'
        ? exporter.toJSON(finalBlocks)
        : exporter.toWordPressHtml(finalBlocks),
    [previewTab, finalBlocks, exporter],
  )

  const handleCopy = async (format: 'json' | 'html') => {
    await exporter.copyToClipboard(finalBlocks, format)
    setCopied(format)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Export your blocks</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border rounded-lg p-6 bg-white">
          <h3 className="font-semibold mb-1">WordPress HTML</h3>
          <p className="text-sm text-gray-600 mb-4">
            Paste directly into the WordPress editor (Code editor mode) — blocks
            arrive fully editable.
          </p>
          <div className="space-y-2">
            <button
              onClick={() => handleCopy('html')}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded font-semibold"
            >
              {copied === 'html' ? '✓ Copied!' : '📋 Copy to Clipboard'}
            </button>
            <button
              onClick={() => exporter.downloadHTML(finalBlocks)}
              className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 py-2 px-4 rounded"
            >
              ⬇️ Download .html
            </button>
          </div>
        </div>

        <div className="border rounded-lg p-6 bg-white">
          <h3 className="font-semibold mb-1">Block JSON</h3>
          <p className="text-sm text-gray-600 mb-4">
            Parsed-block array for the WordPress REST API or programmatic use.
          </p>
          <div className="space-y-2">
            <button
              onClick={() => handleCopy('json')}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded font-semibold"
            >
              {copied === 'json' ? '✓ Copied!' : '📋 Copy to Clipboard'}
            </button>
            <button
              onClick={() => exporter.downloadJSON(finalBlocks)}
              className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 py-2 px-4 rounded"
            >
              ⬇️ Download .json
            </button>
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="border rounded-lg bg-white overflow-hidden">
        <div className="flex border-b bg-gray-50">
          {(['html', 'json'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setPreviewTab(tab)}
              className={`px-4 py-2 text-sm font-semibold ${
                previewTab === tab
                  ? 'bg-white border-b-2 border-blue-600 text-blue-700'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {tab === 'html' ? 'WordPress HTML' : 'Block JSON'}
            </button>
          ))}
        </div>
        <pre className="p-4 font-mono text-xs overflow-auto max-h-96 whitespace-pre-wrap">
          {preview}
        </pre>
      </div>

      <div className="flex justify-between">
        <button onClick={onBack} className="px-4 py-2 text-gray-600 hover:text-gray-900">
          ← Back
        </button>
        <button
          onClick={onStartOver}
          className="px-4 py-2 text-blue-600 hover:text-blue-800"
        >
          ↻ Start a new conversion
        </button>
      </div>
    </div>
  )
}
