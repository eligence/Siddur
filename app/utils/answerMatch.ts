import type { LexiconResult } from '../../shared/types/siddur'

const STOPWORDS = new Set(['to', 'the', 'a', 'an', 'of', 'be'])

function stem(word: string) {
  return word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .map(stem)
}

export function matchesLexicon(answer: string, results: LexiconResult[]): boolean {
  const answerTokens = tokenize(answer)
  if (!answerTokens.length) return false
  const phrase = answerTokens.join(' ')

  const glosses = results
    .flatMap((r) => r.definitions)
    .flatMap((d) => d.split(/[,;:()[\]]|\bor\b/i))
    .map(tokenize)
    .filter((g) => g.length)

  if (glosses.some((g) => g.join(' ') === phrase)) return true
  const single = answerTokens[0]!
  if (answerTokens.length === 1 && single.length >= 3) {
    return glosses.some((g) => g.length <= 3 && g.includes(single))
  }
  return false
}
