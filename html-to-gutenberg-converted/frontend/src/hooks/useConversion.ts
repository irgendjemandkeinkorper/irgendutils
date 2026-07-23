import { useCallback, useEffect, useState } from 'react'
import { ConversionState, FallbackBlockOption } from '../types'
import { convertHtml } from '../services/converter'

const STORAGE_KEY = 'conversionState'

const defaultState: ConversionState = {
  step: 'input',
  loading: false,
}

/**
 * Main wizard state: input → source → review → export.
 * Persisted to localStorage so a refresh doesn't lose work (gotcha #10).
 */
export const useConversion = () => {
  const [state, setState] = useState<ConversionState>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as ConversionState
        return { ...parsed, loading: false, error: undefined }
      }
    } catch {
      // Corrupt saved state — start fresh
    }
    return defaultState
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Quota exceeded on huge conversions — persistence is best-effort
    }
  }, [state])

  const selectInputType = useCallback((type: ConversionState['inputType']) => {
    setState((prev) => ({ ...prev, inputType: type, step: 'source' }))
  }, [])

  const submitHtml = useCallback((html: string) => {
    if (!html.trim()) return
    setState((prev) => ({ ...prev, loading: true, error: undefined }))

    // Defer so the loading state paints before a large synchronous parse
    setTimeout(() => {
      setState((prev) => {
        try {
          const result = convertHtml(html, prev.inputType ?? 'snippet')
          return {
            ...prev,
            result,
            sourceHtml: html,
            step: result.flaggedSections.length > 0 ? 'review' : 'export',
            loading: false,
          }
        } catch (error) {
          return {
            ...prev,
            error: error instanceof Error ? error.message : 'Conversion failed',
            loading: false,
          }
        }
      })
    }, 0)
  }, [])

  const resolveFlag = useCallback((flagId: string, choice: FallbackBlockOption) => {
    setState((prev) => {
      if (!prev.result) return prev
      return {
        ...prev,
        result: {
          ...prev.result,
          flaggedSections: prev.result.flaggedSections.map((flag) =>
            flag.id === flagId ? { ...flag, userChoice: choice } : flag,
          ),
        },
      }
    })
  }, [])

  const goToStep = useCallback((step: ConversionState['step']) => {
    setState((prev) => ({ ...prev, step }))
  }, [])

  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setState(defaultState)
  }, [])

  return { state, selectInputType, submitHtml, resolveFlag, goToStep, reset }
}
