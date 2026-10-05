const STORAGE_KEY = 'siddur:quiz-progress-v1'

export const MASTERY_STREAK = 3

export interface QuizWordProgress {
  correct: number
  incorrect: number
  streak: number
  lastSeen: number
}

export function useQuizProgress() {
  const progress = useState<Record<string, QuizWordProgress>>('quiz-progress', () => ({}))

  if (import.meta.client) {
    const loaded = useState('quiz-progress-loaded', () => false)
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
        () => {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(progress.value))
          } catch {
            // ignore quota/access errors
          }
        },
        { deep: true },
      )
    }
  }

  function record(key: string, correct: boolean) {
    const p = progress.value[key] ?? { correct: 0, incorrect: 0, streak: 0, lastSeen: 0 }
    progress.value[key] = {
      correct: p.correct + (correct ? 1 : 0),
      incorrect: p.incorrect + (correct ? 0 : 1),
      streak: correct ? p.streak + 1 : 0,
      lastSeen: Date.now(),
    }
  }

  function isMastered(key: string) {
    return (progress.value[key]?.streak ?? 0) >= MASTERY_STREAK
  }

  return { progress, record, isMastered }
}
