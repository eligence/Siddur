<script setup lang="ts">
import type { QuizWord } from '~~/shared/types/siddur'

const { data: words, pending, error } = useFetch<QuizWord[]>('/api/siddur/words', { server: false })
const { progress, isMastered } = useQuizProgress()
const { getVariations } = useWordProgress()

const showMasteredOnly = ref(false)

// Rank is the position in the full frequency-sorted list, so it stays stable when filtering.
const ranked = computed(() => (words.value ?? []).map((w, i) => ({ ...w, rank: i + 1 })))
const masteredCount = computed(() => ranked.value.filter((w) => isMastered(w.key)).length)
const visible = computed(() =>
  showMasteredOnly.value ? ranked.value.filter((w) => isMastered(w.key)) : ranked.value,
)
</script>

<template>
  <div class="min-h-screen bg-neutral-50">
    <header class="flex items-center justify-between gap-2 border-b border-neutral-200 bg-white px-4 py-3">
      <UButton to="/" icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="sm">Siddur</UButton>
      <h1 class="text-base font-semibold">Word List</h1>
      <UButton to="/quiz" icon="i-lucide-graduation-cap" color="neutral" variant="outline" size="sm">Quiz</UButton>
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
              <UBadge color="success" variant="subtle">Mastered {{ masteredCount }}</UBadge>
            </div>
            <USwitch v-model="showMasteredOnly" label="Show mastered only" />
          </div>

          <p v-if="!visible.length" class="rounded-lg border border-neutral-200 bg-white p-8 text-center italic text-neutral-500">
            No mastered words yet — take the quiz to master some.
          </p>

          <table v-else class="w-full overflow-hidden rounded-lg border border-neutral-200 bg-white text-sm">
            <thead class="bg-neutral-100 text-left text-xs uppercase text-neutral-500">
              <tr>
                <th class="px-3 py-2 text-right">#</th>
                <th class="px-3 py-2 text-right">Word</th>
                <th class="px-3 py-2 text-right">Count</th>
                <th class="px-3 py-2">Streak</th>
                <th class="px-3 py-2">Your translations</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="w in visible" :key="w.key" class="word-row border-t border-neutral-100">
                <td class="px-3 py-1.5 text-right tabular-nums text-neutral-400">{{ w.rank }}</td>
                <td class="list-word px-3 py-1.5 text-right" dir="rtl">{{ w.word }}</td>
                <td class="px-3 py-1.5 text-right tabular-nums">{{ w.count }}</td>
                <td class="px-3 py-1.5">
                  <UBadge v-if="isMastered(w.key)" color="success" variant="subtle" size="sm">Mastered</UBadge>
                  <span v-else-if="progress[w.key]" class="tabular-nums text-neutral-500">
                    {{ progress[w.key]!.streak }}/{{ MASTERY_STREAK }}
                  </span>
                </td>
                <td class="px-3 py-1.5 text-neutral-600">{{ getVariations(w.word).join(', ') }}</td>
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
/* The full list has thousands of rows; skip layout/paint for off-screen ones. */
.word-row {
  content-visibility: auto;
  contain-intrinsic-size: auto 2.5rem;
}
</style>
