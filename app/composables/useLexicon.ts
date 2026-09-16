import type { LexiconResult } from '../../shared/types/siddur'

interface LexiconState {
  loading: boolean
  error: string | null
  results: LexiconResult[] | null
}

// Trim leading/trailing punctuation and symbols — including Hebrew-block punctuation
// like maqaf (U+05BE), paseq (U+05C0), sof pasuq (U+05C3) and geresh/gershayim
// (U+05F3-4), which can end up merged onto word edges — while keeping letters and
// niqqud/cantillation marks intact so the lexicon can match vowelized forms.
const EDGE_PUNCTUATION = /^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu

export function cleanHebrewWord(word: string): string {
  return word.replace(EDGE_PUNCTUATION, '')
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
