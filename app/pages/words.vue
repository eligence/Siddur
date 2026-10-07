<script setup lang="ts">
import type { QuizWord } from '~~/shared/types/siddur'

const { data: words, pending, error } = useFetch<QuizWord[]>('/api/siddur/words', { server: false })
const { progress, isMastered } = useQuizProgress()
const { getVariations } = useWordProgress()

const showMasteredOnly = ref(false)
// Hides all personal/quiz UI, leaving just the Word / Count / # table.
const wordsOnly = ref(false)
type SortKey = 'count' | 'alpha' | 'rank'
type SortDir = 'asc' | 'desc'
const DEFAULT_DIR: Record<SortKey, SortDir> = { count: 'desc', alpha: 'asc', rank: 'asc' }
const sortBy = ref<SortKey>('count')
const sortDir = ref<SortDir>('desc')

// Clicking the active header flips direction; clicking another uses its default.
function setSort(key: SortKey) {
  if (sortBy.value === key) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else {
    sortBy.value = key
    sortDir.value = DEFAULT_DIR[key]
  }
}

function sortIcon(key: SortKey) {
  if (sortBy.value !== key) return 'i-lucide-chevrons-up-down'
  return sortDir.value === 'asc' ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'
}

function ariaSort(key: SortKey) {
  if (sortBy.value !== key) return 'none'
  return sortDir.value === 'asc' ? 'ascending' : 'descending'
}

// Final forms (ך ם ן ף ץ) sort as their regular letters; the remaining Hebrew letters
// are already in alphabetical order by code point (U+05D0–U+05EA).
const FINALS: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' }
const alphaKey = (key: string) => key.replace(/[ךםןףץ]/g, (c) => FINALS[c]!)

// Rank is the position in the full frequency-sorted list, so it stays stable when filtering.
const ranked = computed(() => (words.value ?? []).map((w, i) => ({ ...w, rank: i + 1 })))
const masteredCount = computed(() => ranked.value.filter((w) => isMastered(w.key)).length)
const sorted = computed(() => {
  // Count (desc) and rank (asc) share the frequency order of `ranked`.
  const list =
    sortBy.value !== 'alpha'
      ? ranked.value
      : ranked.value
          .map((w) => ({ w, k: alphaKey(w.key) }))
          .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.w.rank - b.w.rank))
          .map(({ w }) => w)
  return sortDir.value === DEFAULT_DIR[sortBy.value] ? list : [...list].reverse()
})
const visible = computed(() =>
  showMasteredOnly.value && !wordsOnly.value ? sorted.value.filter((w) => isMastered(w.key)) : sorted.value,
)
</script>

<template>
  <div class="min-h-screen bg-neutral-50">
    <header class="flex items-center justify-between gap-2 border-b border-neutral-200 bg-white px-4 py-3">
      <UButton to="/" icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="sm">Siddur</UButton>
      <h1 class="text-base font-semibold">Word List</h1>
      <UButton v-if="!wordsOnly" to="/quiz" icon="i-lucide-graduation-cap" color="neutral" variant="outline" size="sm">Quiz</UButton>
      <span v-else />
    </header>

    <ClientOnly>
      <main class="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
        <p v-if="pending" class="text-center italic text-neutral-500">
          Building word list from the full siddur… (first load can take a while)
        </p>
        <p v-else-if="error" class="text-center text-red-700">Failed to load word list.</p>

        <template v-else-if="words">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap gap-2 text-sm">
              <UBadge color="neutral" variant="subtle">{{ words.length }} unique words</UBadge>
              <UBadge v-if="!wordsOnly" color="success" variant="subtle">Mastered {{ masteredCount }}</UBadge>
            </div>
            <div class="flex flex-wrap items-center gap-4">
              <USwitch v-if="!wordsOnly" v-model="showMasteredOnly" label="Show mastered only" />
              <USwitch v-model="wordsOnly" label="Words only" />
            </div>
          </div>

          <p v-if="!visible.length" class="rounded-lg border border-neutral-200 bg-white p-8 text-center italic text-neutral-500">
            No mastered words yet — take the quiz to master some.
          </p>

          <table v-else class="w-full overflow-hidden rounded-lg border border-neutral-200 bg-white text-sm">
            <thead class="bg-neutral-100 text-left text-xs uppercase text-neutral-500">
              <tr>
                <template v-if="!wordsOnly">
                  <th class="px-3 py-2">Streak</th>
                  <th class="px-3 py-2">Your translations</th>
                </template>
                <th class="px-3 py-2 text-right" :aria-sort="ariaSort('alpha')">
                  <button type="button" class="sort-btn" :class="{ active: sortBy === 'alpha' }" title="Sort alphabetically" @click="setSort('alpha')">
                    Word {{ sortBy === 'alpha' && sortDir === 'desc' ? 'ת–א' : 'א–ת' }}
                    <UIcon :name="sortIcon('alpha')" class="size-3.5" />
                  </button>
                </th>
                <th class="px-3 py-2 text-right" :aria-sort="ariaSort('count')">
                  <button type="button" class="sort-btn" :class="{ active: sortBy === 'count' }" title="Sort by frequency" @click="setSort('count')">
                    Count
                    <UIcon :name="sortIcon('count')" class="size-3.5" />
                  </button>
                </th>
                <th class="px-3 py-2 text-right" :aria-sort="ariaSort('rank')">
                  <button type="button" class="sort-btn" :class="{ active: sortBy === 'rank' }" title="Sort by rank" @click="setSort('rank')">
                    #
                    <UIcon :name="sortIcon('rank')" class="size-3.5" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="w in visible" :key="w.key" class="word-row border-t border-neutral-100">
                <template v-if="!wordsOnly">
                  <td class="px-3 py-1.5">
                    <UBadge v-if="isMastered(w.key)" color="success" variant="subtle" size="sm">Mastered</UBadge>
                    <span v-else-if="progress[w.key]" class="tabular-nums text-neutral-500">
                      {{ progress[w.key]!.streak }}/{{ MASTERY_STREAK }}
                    </span>
                  </td>
                  <td class="px-3 py-1.5 text-neutral-600">{{ getVariations(w.word).join(', ') }}</td>
                </template>
                <td class="px-3 py-1.5 text-right" dir="rtl">
                  <span class="list-word">{{ w.word }}</span>
                  <span v-if="w.forms.length > 1" class="list-forms block text-neutral-400">
                    {{ w.forms.filter((f) => f !== w.word).join(' · ') }}
                  </span>
                </td>
                <td class="px-3 py-1.5 text-right tabular-nums">{{ w.count }}</td>
                <td class="px-3 py-1.5 text-right tabular-nums text-neutral-400">{{ w.rank }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </main>
    </ClientOnly>
  </div>
</template>

<style scoped>
.list-word {
  font-family: var(--hebrew-font, inherit);
  font-size: 1.25rem;
}
.list-forms {
  font-family: var(--hebrew-font, inherit);
  font-size: 0.85rem;
}
.sort-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  text-transform: inherit;
  cursor: pointer;
}
.sort-btn:hover,
.sort-btn.active {
  color: #111;
}
.sort-btn.active {
  text-decoration: underline;
  text-underline-offset: 3px;
}
/* The full list has thousands of rows; skip layout/paint for off-screen ones. */
.word-row {
  content-visibility: auto;
  contain-intrinsic-size: auto 2.5rem;
}
</style>
