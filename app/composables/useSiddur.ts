import type { SectionText, SiddurTocResponse } from '../../shared/types/siddur'

/** Fetches the Weekday Siddur Chabad table of contents (SSR-friendly, cached by the server route). */
export function useSiddurToc() {
  return useFetch<SiddurTocResponse>('/api/siddur')
}

/**
 * Client-side cache of loaded section texts, keyed by ref.
 * Shared across component instances via useState so re-visiting a section is instant.
 */
export function useSiddurSections() {
  const sections = useState<Record<string, SectionText>>('siddur-sections', () => ({}))
  const loading = useState<Record<string, boolean>>('siddur-sections-loading', () => ({}))
  const errors = useState<Record<string, string>>('siddur-sections-errors', () => ({}))

  async function loadSection(ref: string) {
    if (sections.value[ref] || loading.value[ref]) return
    loading.value[ref] = true
    delete errors.value[ref]
    try {
      const data = await $fetch<SectionText>('/api/siddur/text', { query: { ref } })
      sections.value[ref] = data
    } catch (e) {
      errors.value[ref] = e instanceof Error ? e.message : 'Failed to load section'
    } finally {
      loading.value[ref] = false
    }
  }

  return { sections, loading, errors, loadSection }
}
