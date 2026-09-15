import type { LexiconResult } from '../../shared/types/siddur'

const SEFARIA_BASE = 'https://www.sefaria.org'

// Prefer concise, modern-Hebrew-friendly dictionaries before verbose biblical ones.
const LEXICON_PRIORITY = ['Klein Dictionary', 'Jastrow Dictionary', 'BDB Dictionary', 'BDB Augmented Strong']

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function truncate(value: string, max = 160): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

interface LexiconSenseNode {
  definition?: string
  senses?: LexiconSenseNode[]
}

function collectDefinitions(node: LexiconSenseNode | undefined, out: string[], depth = 0) {
  if (!node || out.length >= 3 || depth > 2) return
  if (typeof node.definition === 'string' && node.definition.trim()) {
    const clean = stripHtml(node.definition)
    if (clean) out.push(truncate(clean))
  }
  if (Array.isArray(node.senses)) {
    for (const sense of node.senses) {
      if (out.length >= 3) break
      collectDefinitions(sense, out, depth + 1)
    }
  }
}

interface RawLexiconEntry {
  headword?: string
  parent_lexicon?: string
  content?: LexiconSenseNode
}

/** Simplify Sefaria's verbose, multi-dictionary lexicon response into a short list of glosses. */
export function simplifyLexiconEntries(raw: unknown): LexiconResult[] {
  if (!Array.isArray(raw)) return []

  const results: LexiconResult[] = (raw as RawLexiconEntry[])
    .map((entry) => {
      const definitions: string[] = []
      collectDefinitions(entry.content, definitions)
      return {
        headword: entry.headword ?? '',
        lexicon: entry.parent_lexicon ?? '',
        definitions,
      }
    })
    .filter((entry) => entry.definitions.length > 0)

  results.sort((a, b) => {
    const ai = LEXICON_PRIORITY.indexOf(a.lexicon)
    const bi = LEXICON_PRIORITY.indexOf(b.lexicon)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })

  return results.slice(0, 4)
}

/** Fetch and cache a simplified lexicon lookup for a single Hebrew word. */
export async function fetchLexiconEntry(word: string): Promise<LexiconResult[]> {
  const storage = useStorage('cache')
  const cacheKey = `sefaria:word:${word}`
  const cached = await storage.getItem<LexiconResult[]>(cacheKey)
  if (cached) return cached

  const raw = await $fetch(`${SEFARIA_BASE}/api/words/${encodeURIComponent(word)}`)
  const result = simplifyLexiconEntries(raw)
  await storage.setItem(cacheKey, result)
  return result
}
