const STORAGE_KEY = 'siddur:word-progress'

/**
 * Reactive, localStorage-backed map of the user's typed English guesses,
 * keyed by a unique id per word occurrence (ref + paragraph index + word index).
 */
export function useWordProgress() {
  const progress = useState<Record<string, string>>('word-progress', () => ({}))

  if (import.meta.client) {
    const loaded = useState('word-progress-loaded', () => false)
    if (!loaded.value) {
      loaded.value = true
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) Object.assign(progress.value, JSON.parse(raw))
      } catch {
        // ignore corrupt/inaccessible storage
      }
      watch(
        progress,
        (value) => {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
          } catch {
            // ignore quota/access errors
          }
        },
        { deep: true },
      )
    }
  }

  function getValue(id: string) {
    return progress.value[id] ?? ''
  }

  function setValue(id: string, value: string) {
    progress.value[id] = value
  }

  return { progress, getValue, setValue }
}
