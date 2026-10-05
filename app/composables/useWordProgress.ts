const STORAGE_KEY = 'siddur:word-progress-v3'

/**
 * Reactive, localStorage-backed storage with two layers:
 * - variations: Record<hebrewWord, string[]> — shared pool of all guesses
 *   entered for a given Hebrew word across every occurrence.
 * - selections: Record<occurrenceId, string> — the active value for a specific
 *   word-input, so selecting a variation only affects that one input.
 */
export function useWordProgress() {
  const variations = useState<Record<string, string[]>>('word-variations', () => ({}))
  const selections = useState<Record<string, string>>('word-selections', () => ({}))
  const wordToIds = useState<Record<string, string[]>>('word-to-ids', () => ({}))

  if (import.meta.client) {
    const loaded = useState('word-progress-loaded', () => false)
    if (!loaded.value) {
      loaded.value = true
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (parsed.variations) Object.assign(variations.value, parsed.variations)
          if (parsed.selections) Object.assign(selections.value, parsed.selections)
        }
      } catch {
        // ignore corrupt/inaccessible storage
      }
      watch(
        [variations, selections],
        () => {
          try {
            localStorage.setItem(
              STORAGE_KEY,
              JSON.stringify({ variations: variations.value, selections: selections.value }),
            )
          } catch {
            // ignore quota/access errors
          }
        },
        { deep: true },
      )
    }
  }

  function getValue(id: string) {
    return selections.value[id] ?? ''
  }

  function setValue(id: string, value: string) {
    selections.value[id] = value
  }

  function getVariations(word: string): string[] {
    return variations.value[normalizeHebrewWord(word)] ?? []
  }

  function addVariation(word: string, value: string) {
    if (!value.trim()) return
    const key = normalizeHebrewWord(word)
    const list = variations.value[key] ?? []
    const lower = value.toLowerCase()
    // Ignore case-insensitive duplicates (e.g. "blessed" vs "Blessed").
    if (!list.some((v) => v.toLowerCase() === lower)) {
      variations.value[key] = [...list, value]
    }
    // Populate all inputs for the same Hebrew word with the entered value.
    for (const id of wordToIds.value[key] ?? []) {
      selections.value[id] = value
    }
  }

  function registerWordId(word: string, id: string) {
    const key = normalizeHebrewWord(word)
    const list = wordToIds.value[key] ?? []
    if (!list.includes(id)) {
      wordToIds.value[key] = [...list, id]
    }
    // On reload, wordToIds is empty so addVariation never propagated.
    // If this word has variations but no selection for this ID, auto-populate
    // with the most recent variation.
    if (!selections.value[id]) {
      const vars = variations.value[key] ?? []
      if (vars.length) {
        selections.value[id] = vars[vars.length - 1]
      }
    }
  }

  function removeVariation(word: string, value: string) {
    const key = normalizeHebrewWord(word)
    const list = variations.value[key] ?? []
    variations.value[key] = list.filter((v) => v !== value)
    // Clear any per-occurrence selections that pointed at the removed value.
    for (const id of Object.keys(selections.value)) {
      if (selections.value[id] === value) selections.value[id] = ''
    }
  }

  return { getValue, setValue, getVariations, addVariation, removeVariation, registerWordId }
}
