import { useRef, useState } from 'react'
import { ConversionState } from '../types'

interface Props {
  state: ConversionState
  onSubmit: (html: string) => void
  onBack: () => void
}

const SAMPLE_HTML = `<h1>Welcome to Our Site</h1>
<p>This is an <strong>example</strong> paragraph with <a href="/about">a link</a>.</p>
<img src="https://example.com/photo.jpg" alt="A photo" />
<ul>
  <li>First item</li>
  <li>Second item
    <ul><li>Nested item</li></ul>
  </li>
</ul>
<div style="display: grid; grid-template-columns: 1fr 1fr;">
  <div><p>Left column</p></div>
  <div><p>Right column</p></div>
</div>
<blockquote>Stay hungry, stay foolish.<cite>Steve Jobs</cite></blockquote>`

export const SourceUpload = ({ state, onSubmit, onBack }: Props) => {
  const [html, setHtml] = useState(state.sourceHtml ?? '')
  const fileInput = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      alert('HTML file exceeds 10MB limit')
      return
    }
    setHtml(await file.text())
  }

  return (
    <div className="bg-white rounded-lg p-8 border border-gray-200 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">
          {state.inputType === 'page' ? 'Upload or paste your HTML page' : 'Paste your HTML'}
        </h2>
        <button
          onClick={() => setHtml(SAMPLE_HTML)}
          className="text-sm text-blue-600 hover:underline"
        >
          Load sample
        </button>
      </div>

      <textarea
        value={html}
        onChange={(e) => setHtml(e.target.value)}
        className="w-full h-64 p-4 border border-gray-300 rounded font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        placeholder="<h1>Title</h1>&#10;<p>Content</p>"
        spellCheck={false}
      />

      <div className="flex items-center gap-3">
        <input
          ref={fileInput}
          type="file"
          accept=".html,.htm,text/html"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <button
          onClick={() => fileInput.current?.click()}
          className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 text-sm"
        >
          📁 Upload .html file
        </button>
        <span className="text-xs text-gray-500">Max 10MB</span>
      </div>

      <div className="flex justify-between pt-2">
        <button onClick={onBack} className="px-4 py-2 text-gray-600 hover:text-gray-900">
          ← Back
        </button>
        <button
          onClick={() => onSubmit(html)}
          disabled={!html.trim()}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded font-semibold"
        >
          Convert →
        </button>
      </div>
    </div>
  )
}
