import { InputSelector } from './components/InputSelector'
import { SourceUpload } from './components/SourceUpload'
import { ConversionReview } from './components/ConversionReview'
import { ExportOptions } from './components/ExportOptions'
import { useConversion } from './hooks/useConversion'

const STEPS = [
  { id: 'input', label: '1. Input type' },
  { id: 'source', label: '2. Source' },
  { id: 'review', label: '3. Review' },
  { id: 'export', label: '4. Export' },
] as const

function App() {
  const { state, selectInputType, submitHtml, resolveFlag, goToStep, reset } =
    useConversion()

  const currentIdx = STEPS.findIndex((s) => s.id === state.step)

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold mb-2">
            HTML to Gutenberg Converter
          </h1>
          <p className="text-gray-600">
            Convert your HTML to WordPress Gutenberg blocks
          </p>
        </header>

        {/* Stepper */}
        <nav className="flex gap-2 mb-8 text-sm">
          {STEPS.map((step, i) => (
            <div
              key={step.id}
              className={`flex-1 py-2 px-3 rounded text-center font-medium ${
                i === currentIdx
                  ? 'bg-blue-600 text-white'
                  : i < currentIdx
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-gray-100 text-gray-400'
              }`}
            >
              {step.label}
            </div>
          ))}
        </nav>

        {state.error && (
          <div className="bg-red-50 border border-red-200 rounded p-4 text-red-800 mb-6">
            Error: {state.error}
          </div>
        )}

        {state.loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin text-3xl">⏳</div>
            <p className="mt-4 text-gray-600">Converting…</p>
          </div>
        ) : (
          <>
            {state.step === 'input' && (
              <InputSelector state={state} onSelect={selectInputType} />
            )}

            {state.step === 'source' && (
              <SourceUpload
                state={state}
                onSubmit={submitHtml}
                onBack={() => goToStep('input')}
              />
            )}

            {state.step === 'review' && state.result && (
              <ConversionReview
                result={state.result}
                onResolveFlag={resolveFlag}
                onContinue={() => goToStep('export')}
                onBack={() => goToStep('source')}
              />
            )}

            {state.step === 'export' && state.result && (
              <ExportOptions
                result={state.result}
                onBack={() =>
                  goToStep(
                    state.result!.flaggedSections.length > 0 ? 'review' : 'source',
                  )
                }
                onStartOver={reset}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default App
