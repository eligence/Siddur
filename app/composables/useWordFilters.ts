import type { QuizWord, WordPlace } from '~~/shared/types/siddur'

// Shared between /words and /quiz: hide hapax legomena, sight particles,
// and Aramaic forms, or hide words below a minimum occurrence count.
// Persisted to localStorage so the same filters apply across both pages.
const FILTER_STORAGE_KEY = 'siddur:word-filters-v1'

export function useWordFilters() {
  const hideRare = useState('wordFilters:hideRare', () => false)
  const hideSight = useState('wordFilters:hideSight', () => false)
  const hideAramaic = useState('wordFilters:hideAramaic', () => false)
  const minCount = useState('wordFilters:minCount', () => 1)
  // Selected siddur location: a leaf section ref or "ref#para"; null = everywhere.
  const place = useState<string | null>('wordFilters:place', () => null)

  const minCountItems = [
    { label: 'All counts', value: 1 },
    { label: '≥2', value: 2 },
    { label: '≥3', value: 3 },
    { label: '≥4', value: 4 },
    { label: '≥5', value: 5 },
    { label: '≥10', value: 10 },
  ]

  const { data: places } = useFetch<WordPlace[]>('/api/siddur/places', {
    server: false,
    default: () => [],
  })
  const placeItems = computed(() => [
    { label: 'Everywhere', value: null },
    ...(places.value ?? []).map((p) => ({ label: p.label, value: p.value })),
  ])

  /** Does the word occur in the selected section/paragraph? */
  function matchesPlace(w: QuizWord) {
    if (!place.value) return true
    const sel = place.value
    const isPara = sel.includes('#')
    return (w.locs ?? []).some((loc) => (isPara ? loc === sel : loc.startsWith(`${sel}#`)))
  }

  if (import.meta.client) {
    try {
      const saved = JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) ?? '{}')
      if (typeof saved.hideRare === 'boolean') hideRare.value = saved.hideRare
      if (typeof saved.hideSight === 'boolean') hideSight.value = saved.hideSight
      if (typeof saved.hideAramaic === 'boolean') hideAramaic.value = saved.hideAramaic
      if (typeof saved.minCount === 'number') minCount.value = saved.minCount
      if (typeof saved.place === 'string' || saved.place === null) place.value = saved.place
    }
    catch { /* ignore corrupt storage */ }
    watch(
      [hideRare, hideSight, hideAramaic, minCount, place],
      () => {
        try {
          localStorage.setItem(
            FILTER_STORAGE_KEY,
            JSON.stringify({
              hideRare: hideRare.value,
              hideSight: hideSight.value,
              hideAramaic: hideAramaic.value,
              minCount: minCount.value,
              place: place.value,
            }),
          )
        }
        catch { /* ignore quota errors */ }
      },
      { deep: true },
    )
  }

  return { hideRare, hideSight, hideAramaic, minCount, minCountItems, place, places, placeItems, matchesPlace }
}
