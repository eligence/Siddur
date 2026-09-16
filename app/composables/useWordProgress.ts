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
    return variations.value[word] ?? []
  }

  function addVariation(word: string, value: string) {
    if (!value.trim()) return
    const list = variations.value[word] ?? []
    const lower = value.toLowerCase()
    // Ignore case-insensitive duplicates (e.g. "blessed" vs "Blessed").
    if (!list.some((v) => v.toLowerCase() === lower)) {
      variations.value[word] = [...list, value]
    }
    // Populate all inputs for the same Hebrew word with the entered value.
    for (const id of wordToIds.value[word] ?? []) {
      selections.value[id] = value
    }
  }

  function registerWordId(word: string, id: string) {
    const list = wordToIds.value[word] ?? []
    if (!list.includes(id)) {
      wordToIds.value[word] = [...list, id]
    }
  }

  function removeVariation(word: string, value: string) {
    const list = variations.value[word] ?? []
    variations.value[word] = list.filter((v) => v !== value)
    // Clear any per-occurrence selections that pointed at the removed value.
    for (const id of Object.keys(selections.value)) {
      if (selections.value[id] === value) selections.value[id] = ''
    }
  }

  return { getValue, setValue, getVariations, addVariation, removeVariation, registerWordId }
}
