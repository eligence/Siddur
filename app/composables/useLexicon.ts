import type { LexiconResult } from '../../shared/types/siddur'

interface LexiconState {
  loading: boolean
  error: string | null
  results: LexiconResult[] | null
}

/** Client-side cache of Sefaria Lexicon lookups, keyed by cleaned Hebrew word. */
export function useLexicon() {
  const cache = useState<Record<string, LexiconState>>('lexicon-cache', () => ({}))

  async function lookup(rawWord: string) {
    const word = cleanHebrewWord(rawWord)
    if (!word) return
    if (cache.value[word] && !cache.value[word].error) return

    cache.value[word] = { loading: true, error: null, results: null }
    try {
      const results = await $fetch<LexiconResult[]>(`/api/words/${encodeURIComponent(word)}`)
      cache.value[word] = { loading: false, error: null, results }
    } catch (e) {
      cache.value[word] = {
        loading: false,
        error: e instanceof Error ? e.message : 'Lookup failed',
        results: null,
      }
    }
  }

  function stateFor(rawWord: string): LexiconState | undefined {
    return cache.value[cleanHebrewWord(rawWord)]
  }

  return { lookup, stateFor }
}
