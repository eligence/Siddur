<script setup lang="ts">
import type { QuizWord } from '~~/shared/types/siddur'

const REQUEUE_GAP = 5

const { data: words, pending, error } = useFetch<QuizWord[]>('/api/siddur/words', { server: false })
const { progress, record, isMastered } = useQuizProgress()
const { addVariation } = useWordProgress()
const { lookup, stateFor } = useLexicon()

const queue = ref<QuizWord[]>([])
const position = ref(0)
const answer = ref('')
const phase = ref<'answering' | 'revealed'>('answering')
const isCorrect = ref(false)
const session = reactive({ correct: 0, incorrect: 0 })
const inputEl = ref<HTMLInputElement | null>(null)

const current = computed(() => queue.value[position.value] ?? null)
const lookupState = computed(() => (current.value ? stateFor(current.value.word) : undefined))
const rankOf = computed(() => {
  const map = new Map<string, number>()
  words.value?.forEach((w, i) => map.set(w.key, i + 1))
  return map
})
const masteredCount = computed(() => words.value?.filter((w) => isMastered(w.key)).length ?? 0)
const currentProgress = computed(() => (current.value ? progress.value[current.value.key] : undefined))

function startSession() {
  queue.value = (words.value ?? []).filter((w) => !isMastered(w.key))
  position.value = 0
  session.correct = 0
  session.incorrect = 0
  resetCard()
}

function resetCard() {
  answer.value = ''
  phase.value = 'answering'
  isCorrect.value = false
  if (current.value) lookup(current.value.word)
  nextTick(() => inputEl.value?.focus())
}

watch(words, (list) => {
  if (list?.length) startSession()
}, { immediate: true })

async function check() {
  const word = current.value
  if (!word || phase.value !== 'answering') return
  await lookup(word.word)
  isCorrect.value = matchesLexicon(answer.value, stateFor(word.word)?.results ?? [])
  phase.value = 'revealed'
}

function next() {
  const word = current.value
  if (!word) return
  if (phase.value === 'revealed') {
    record(word.key, isCorrect.value)
    const value = answer.value.trim()
    if (isCorrect.value) {
      session.correct++
      if (value) addVariation(word.word, value)
    } else {
      session.incorrect++
      queue.value.splice(position.value + 1 + REQUEUE_GAP, 0, word)
    }
  }
  position.value++
  resetCard()
}

function onEnter() {
  if (phase.value === 'answering') check()
  else next()
}
</script>

<template>
  <div class="min-h-screen bg-neutral-50">
    <header class="flex items-center justify-between gap-2 border-b border-neutral-200 bg-white px-4 py-3">
      <UButton to="/" icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="sm">Siddur</UButton>
      <h1 class="text-base font-semibold">Word Quiz</h1>
      <div class="flex gap-2">
      <UButton to="/words" icon="i-lucide-list-ordered" color="neutral" variant="outline" size="sm">Words</UButton>
      <UButton
        icon="i-lucide-rotate-ccw"
        color="neutral"
        variant="outline"
        size="sm"
        :disabled="!words?.length"
        @click="startSession"
      >
        Restart
      </UButton>
      </div>
    </header>

    <ClientOnly>
      <main class="mx-auto flex max-w-xl flex-col gap-4 px-4 py-8">
        <p v-if="pending" class="text-center italic text-neutral-500">
          Building word list from the full siddur… (first load can take a while)
        </p>
        <p v-else-if="error" class="text-center text-red-700">Failed to load word list.</p>

        <template v-else-if="words">
          <div class="flex flex-wrap justify-center gap-2 text-sm">
            <UBadge color="neutral" variant="subtle">Mastered {{ masteredCount }} / {{ words.length }}</UBadge>
            <UBadge color="success" variant="subtle">Correct {{ session.correct }}</UBadge>
            <UBadge color="error" variant="subtle">Incorrect {{ session.incorrect }}</UBadge>
          </div>

          <div v-if="!current" class="rounded-lg border border-neutral-200 bg-white p-8 text-center">
            <p class="mb-4">{{ queue.length ? 'Session complete!' : 'Every word is mastered!' }}</p>
            <UButton icon="i-lucide-rotate-ccw" @click="startSession">Start a new session</UButton>
          </div>

          <div v-else class="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-6">
            <div class="flex justify-between text-xs text-neutral-500">
              <span>#{{ rankOf.get(current.key) }} · appears {{ current.count }}×</span>
              <span v-if="currentProgress">
                streak {{ currentProgress.streak }}/{{ MASTERY_STREAK }}
              </span>
            </div>

            <p class="quiz-word text-center" dir="rtl">{{ current.word }}</p>

            <input
              ref="inputEl"
              v-model="answer"
              type="text"
              autocomplete="off"
              spellcheck="false"
              placeholder="English translation…"
              :readonly="phase === 'revealed'"
              class="w-full rounded-md border border-neutral-300 px-3 py-2 text-center"
              :class="phase === 'revealed' ? (isCorrect ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50') : ''"
              aria-label="English translation"
              @keydown.enter.prevent="onEnter"
            />

            <div v-if="phase === 'answering'" class="flex justify-center gap-2">
              <UButton color="neutral" variant="ghost" @click="next">Skip</UButton>
              <UButton icon="i-lucide-check" @click="check">Check</UButton>
            </div>

            <template v-else>
              <div class="flex items-center justify-center gap-2">
                <UBadge :color="isCorrect ? 'success' : 'error'" variant="solid">
                  {{ isCorrect ? 'Correct' : 'Incorrect' }}
                </UBadge>
                <UButton size="xs" color="neutral" variant="link" @click="isCorrect = !isCorrect">
                  {{ isCorrect ? 'Mark incorrect' : 'I was right' }}
                </UButton>
              </div>

              <div class="rounded-md bg-neutral-50 p-3 text-sm">
                <p v-if="lookupState?.loading" class="italic text-neutral-500">Looking up…</p>
                <p v-else-if="lookupState?.error" class="text-red-700">{{ lookupState.error }}</p>
                <p v-else-if="!lookupState?.results?.length" class="italic text-neutral-500">No dictionary entry found.</p>
                <div v-for="(entry, i) in lookupState?.results ?? []" :key="i" class="mb-2 last:mb-0">
                  <span class="text-xs font-semibold uppercase text-neutral-500">{{ entry.lexicon }}</span>
                  <ul class="list-disc ps-5">
                    <li v-for="(def, j) in entry.definitions" :key="j">{{ def }}</li>
                  </ul>
                </div>
              </div>

              <div class="flex justify-center">
                <UButton icon="i-lucide-arrow-right" trailing @click="next">Next</UButton>
              </div>
            </template>
          </div>
        </template>
      </main>
    </ClientOnly>
  </div>
</template>

<style scoped>
.quiz-word {
  font-family: var(--hebrew-font, inherit);
  font-size: 2.5rem;
  line-height: 1.6;
}
</style>
