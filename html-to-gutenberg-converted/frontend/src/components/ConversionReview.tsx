import { useState } from 'react'
import { ConversionResult, FallbackBlockOption } from '../types'

interface Props {
  result: ConversionResult
  onResolveFlag: (flagId: string, choice: FallbackBlockOption) => void
  onContinue: () => void
  onBack: () => void
}

export const ConversionReview = ({ result, onResolveFlag, onContinue, onBack }: Props) => {
  const [expandedFlag, setExpandedFlag] = useState<string | null>(
    result.flaggedSections.find((f) => !f.userChoice)?.id ?? null,
  )

  const unresolved = result.flaggedSections.filter((f) => !f.userChoice).length

  return (
    <div className="space-y-6">
      <div className="bg-green-50 border border-green-200 rounded p-4">
        <h3 className="font-semibold text-green-900">✓ Auto-mapped blocks</h3>
        <p className="text-sm text-green-800 mt-1">
          {result.metadata.totalBlocks} blocks converted automatically in{' '}
          {result.metadata.conversionTime}ms
        </p>
      </div>

      {result.flaggedSections.length > 0 && (
        <div className="space-y-4">
          <h3 className="font-semibold">
            ⚠️ Sections needing your input{' '}
            <span className="text-sm font-normal text-gray-600">
              ({result.flaggedSections.length - unresolved}/{result.flaggedSections.length}{' '}
              resolved)
            </span>
          </h3>

          {result.flaggedSections.map((flag) => (
            <div
              key={flag.id}
              className={`border rounded-lg p-4 ${
                flag.userChoice
                  ? 'border-green-200 bg-green-50'
                  : 'border-amber-200 bg-amber-50'
              }`}
            >
              <button
                onClick={() => setExpandedFlag(expandedFlag === flag.id ? null : flag.id)}
                className="w-full text-left flex justify-between items-center"
              >
                <div>
                  <div className="font-semibold text-amber-900">
                    {flag.userChoice ? '✓ ' : ''}
                    {flag.type}
                    {flag.userChoice && (
                      <span className="ml-2 text-sm font-normal text-green-700">
                        → {flag.userChoice.label}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-amber-800 mt-1">{flag.description}</div>
                </div>
                <span className="text-2xl shrink-0 ml-4">
                  {expandedFlag === flag.id ? '−' : '+'}
                </span>
              </button>

              {expandedFlag === flag.id && (
                <div className="mt-4 space-y-4">
                  <pre className="bg-gray-100 p-3 rounded font-mono text-xs overflow-auto max-h-40 whitespace-pre-wrap">
                    {flag.htmlSnippet}
                  </pre>

                  <div className="space-y-2">
                    <p className="text-sm font-semibold">Choose how to handle this:</p>
                    {flag.suggestedBlockOptions.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => {
                          onResolveFlag(flag.id, option)
                          // Auto-advance to the next unresolved flag
                          const next = result.flaggedSections.find(
                            (f) => f.id !== flag.id && !f.userChoice,
                          )
                          setExpandedFlag(next?.id ?? null)
                        }}
                        className={`block w-full text-left p-3 rounded border-2 transition bg-white ${
                          flag.userChoice?.id === option.id
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="font-semibold text-sm">{option.label}</div>
                        <div className="text-xs text-gray-600 mt-1">{option.description}</div>
                        {!option.preservesContent && option.id !== 'skip' && (
                          <div className="text-xs text-red-600 mt-1">
                            ⚠️ Content not editable in Gutenberg
                          </div>
                        )}
                        {option.id === 'skip' && (
                          <div className="text-xs text-red-600 mt-1">
                            ⚠️ This section will be removed
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
          <h3 className="font-semibold text-yellow-900">Warnings</h3>
          <ul className="text-sm text-yellow-800 mt-2 space-y-1">
            {result.warnings.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <button onClick={onBack} className="px-4 py-2 text-gray-600 hover:text-gray-900">
          ← Back
        </button>
        <div className="text-right">
          {unresolved > 0 && (
            <p className="text-xs text-gray-500 mb-1">
              {unresolved} unresolved — they'll be exported as Custom HTML
            </p>
          )}
          <button
            onClick={onContinue}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold"
          >
            Continue to Export →
          </button>
        </div>
      </div>
    </div>
  )
}
