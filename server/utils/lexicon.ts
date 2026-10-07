import type { LexiconResult } from '../../shared/types/siddur'
import { consonantalKey, lexiconKey, lexiconLookupCandidates } from '../../shared/utils/hebrew'

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
export function simplifyLexiconEntries(raw: unknown, limit = 4): LexiconResult[] {
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

  return results.slice(0, limit)
}

/** Lookup function returning simplified, *unsliced* entries for a query. */
export type LexiconLookup = (query: string) => Promise<LexiconResult[]>

/**
 * Resolve a word to dictionary entries: exact form first, then fallback candidates.
 * Guessed roots only count when an entry's headword has exactly those consonants,
 * so a wrong guess can't surface an unrelated word. Returns the query that hit.
 */
export async function resolveLexicon(
  word: string,
  lookup: LexiconLookup,
  maxCandidates = 12,
): Promise<{ query: string; results: LexiconResult[] } | null> {
  const exact = await lookup(word)
  if (exact.length) return { query: word, results: exact.slice(0, 4) }
  for (const { query, root } of lexiconLookupCandidates(word, maxCandidates)) {
    let results = await lookup(query)
    if (root) {
      const key = consonantalKey(query)
      results = results.filter((r) => consonantalKey(r.headword) === key)
    }
    if (results.length) return { query, results: results.slice(0, 4) }
  }
  return null
}

/**
 * Precomputed lookups for every siddur word (`npm run lexicon:build`):
 * `forms` maps a lexiconKey() to the query that resolved it ('' = no entry found),
 * `lemmas` maps that query to its entries.
 */
export interface LexiconTable {
  forms: Record<string, string>
  lemmas: Record<string, LexiconResult[]>
}

let tablePromise: Promise<LexiconTable | null> | null = null
function loadLexiconTable() {
  tablePromise ??= useStorage('assets:server')
    .getItem<LexiconTable>('lexicon.json')
    .catch(() => null)
  return tablePromise
}

function fromTable(table: LexiconTable, word: string): LexiconResult[] | undefined {
  const lemma = table.forms[lexiconKey(word)]
  if (lemma === undefined) return undefined
  return lemma ? (table.lemmas[lemma] ?? []) : []
}

async function lookupOnce(word: string): Promise<LexiconResult[]> {
  const raw = await $fetch(`${SEFARIA_BASE}/api/words/${encodeURIComponent(word)}`)
  return simplifyLexiconEntries(raw, Infinity)
}

/**
 * Dictionary entries for a word: precomputed table first (no network), then — for
 * words outside the siddur's word list — a cached live Sefaria lookup with fallbacks.
 */
export async function fetchLexiconEntry(word: string): Promise<LexiconResult[]> {
  const table = await loadLexiconTable()
  if (table) {
    const hit = fromTable(table, word)
    if (hit) return hit
    // The word list splits maqaf-joined tokens (עַל־פְּנֵי), so combine the parts.
    const parts = word.split('\u05BE').filter(Boolean)
    if (parts.length > 1) {
      const partHits = parts.map((p) => fromTable(table, p))
      if (partHits.every((h) => h !== undefined)) return partHits.flatMap((h) => h!.slice(0, 2))
    }
  }

  const storage = useStorage('cache')
  // v4: root guesses are verified against the entry headword.
  const cacheKey = `sefaria:word:v4:${word}`
  const cached = await storage.getItem<LexiconResult[]>(cacheKey)
  if (cached) return cached

  const result = (await resolveLexicon(lexiconKey(word), lookupOnce))?.results ?? []
  await storage.setItem(cacheKey, result)
  return result
}
