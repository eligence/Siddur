const STORAGE_KEY = 'siddur:translation-drafts-v1'

/**
 * Reactive, localStorage-backed map of paragraph translation drafts,
 * keyed by `{ref}::{paragraphIndex}`. Drafts persist across sessions
 * until submitted or discarded.
 */
export function useTranslationDrafts() {
  const drafts = useState<Record<string, string>>('translation-drafts', () => ({}))

  if (import.meta.client) {
    const loaded = useState('translation-drafts-loaded', () => false)
    if (!loaded.value) {
      loaded.value = true
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) Object.assign(drafts.value, JSON.parse(raw))
      } catch {
        // ignore corrupt/inaccessible storage
      }
      watch(
        drafts,
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

  function draftKey(ref: string, paraIndex: number) {
    return `${ref}::${paraIndex}`
  }

  function getDraft(ref: string, paraIndex: number): string {
    return drafts.value[draftKey(ref, paraIndex)] ?? ''
  }

  function setDraft(ref: string, paraIndex: number, value: string) {
    const key = draftKey(ref, paraIndex)
    if (value.trim()) drafts.value[key] = value
    else delete drafts.value[key]
  }

  function clearDraft(ref: string, paraIndex: number) {
    delete drafts.value[draftKey(ref, paraIndex)]
  }

  function hasDraft(ref: string, paraIndex: number): boolean {
    return !!drafts.value[draftKey(ref, paraIndex)]
  }

  return { drafts, getDraft, setDraft, clearDraft, hasDraft }
}
