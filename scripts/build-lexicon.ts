/**
 * Precompute lexicon results for every word form in the siddur.
 *
 *   npm run lexicon:build   (requires `npm run dev` listening on :3000)
 *
 * Resolution order per form: lexicon.overrides.json → exact Sefaria lookup →
 * lexiconLookupCandidates (verified roots win only on a headword match).
 *
 * Writes:
 *   server/assets/lexicon.json            { forms: key → query ('' = no entry), lemmas: query → entries }
 *   server/assets/lexicon.unmatched.txt   keys with no entry, highest-count first — fill in via overrides
 *
 * Raw Sefaria query results are memoized in .cache/sefaria-words.json
 * (gitignored) so interrupted runs resume where they left off.
 */
import type { LexiconResult, QuizWord } from '../shared/types/siddur'
import type { LexiconTable } from '../server/utils/lexicon'
import { resolveLexicon, simplifyLexiconEntries } from '../server/utils/lexicon'
import { lexiconKey } from '../shared/utils/hebrew'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SIDDUR_URL = process.env.SIDDUR_URL ?? 'http://localhost:3000'
const SEFARIA_BASE = 'https://www.sefaria.org'
const OUT_FILE = resolve('server/assets/lexicon.json')
const OVERRIDES_FILE = resolve('server/assets/lexicon.overrides.json')
const UNMATCHED_FILE = resolve('server/assets/lexicon.unmatched.txt')
const QUERY_CACHE_FILE = resolve('.cache/sefaria-words.json')

// --- Load persisted query cache (survives interruptions) ---
let persisted: Record<string, LexiconResult[]> = {}
try {
  persisted = JSON.parse(readFileSync(QUERY_CACHE_FILE, 'utf8'))
} catch {
  // first run / unreadable
}
const memo = new Map<string, Promise<LexiconResult[]>>()
let pendingWrites = 0
let savedCount = Object.keys(persisted).length
const inflight = { done: 0, queries: savedCount }

function flushCache() {
  mkdirSync(resolve('.cache'), { recursive: true })
  writeFileSync(QUERY_CACHE_FILE, JSON.stringify(persisted))
}

async function sefariaQuery(query: string): Promise<LexiconResult[]> {
  if (query in persisted) return persisted[query]!
  return memo.get(query) ?? memo.set(query, fetchWithRetry(query).then((r) => {
    persisted[query] = r
    if (++pendingWrites % 300 === 0) flushCache()
    return r
  })).get(query)!
}

async function fetchWithRetry(query: string, attempts = 3): Promise<LexiconResult[]> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${SEFARIA_BASE}/api/words/${encodeURIComponent(query)}`)
      if (res.ok) return simplifyLexiconEntries(await res.json(), Infinity)
      if (res.status >= 400 && res.status < 500) return []
      throw new Error(`HTTP ${res.status}`)
    } catch (e) {
      if (i === attempts - 1) throw e
      await new Promise((r) => setTimeout(r, 500 * 2 ** i))
    }
  }
  return []
}

// --- Overrides: { key: query } — the query to look up instead of the key's own
// candidates ('' = confirmed no entry exists). For hand-filled fixes. ---
let overrides: Record<string, string> = {}
try {
  overrides = JSON.parse(readFileSync(OVERRIDES_FILE, 'utf8'))
} catch {
  // none
}

// --- Collect the word forms ---
console.log(`Fetching word list from ${SIDDUR_URL}/api/siddur/words …`)
const words: QuizWord[] = await (await fetch(`${SIDDUR_URL}/api/siddur/words`)).json()

const formFreq = new Map<string, number>() // key → occurrences (sum of its forms' words' counts)
const keys = new Set<string>()
for (const w of words) {
  for (const form of w.forms) {
    const key = lexiconKey(form)
    keys.add(key)
    formFreq.set(key, Math.max(formFreq.get(key) ?? 0, w.count))
  }
}
console.log(`${words.length} words, ${formFreq.size} unique lexicon keys`)

// --- Resolve each key, concurrency-limited ---
const forms: Record<string, string> = {}
const unmatched: { key: string; count: number }[] = []
let done = 0
let cursor = 0
const keyList = [...keys]

async function worker() {
  while (cursor < keyList.length) {
    const key = keyList[cursor++]!
    try {
      const override = overrides[key]
      const hit =
        override === ''
          ? null
          : override !== undefined
            ? { query: override, results: await sefariaQuery(override) }
            : await resolveLexicon(key, sefariaQuery)
      if (hit && hit.results.length) forms[key] = hit.query
      else {
        forms[key] = ''
        unmatched.push({ key, count: formFreq.get(key) ?? 0 })
      }
    } catch (e) {
      // A network/parse failure: leave the key out so runtime falls back to live lookup.
      console.error(`failed: ${key} — ${e instanceof Error ? e.message : e}`)
    }
    if (++done % 500 === 0) console.log(`  ${done}/${keyList.length} resolved, ${unmatched.length} unmatched`)
  }
}
await Promise.all(Array.from({ length: 6 }, worker))
flushCache()

// --- Write outputs ---
const lemmas: LexiconTable['lemmas'] = {}
for (const lemma of Object.values(forms)) {
  if (lemma && !(lemma in lemmas)) lemmas[lemma] = await sefariaQuery(lemma)
}

const table: LexiconTable = {
  forms: Object.fromEntries(Object.entries(forms).sort(([a], [b]) => a.localeCompare(b))),
  lemmas: Object.fromEntries(Object.entries(lemmas).sort(([a], [b]) => a.localeCompare(b))),
}
mkdirSync(resolve('server/assets'), { recursive: true })
writeFileSync(OUT_FILE, JSON.stringify(table))
unmatched.sort((a, b) => b.count - a.count)
writeFileSync(UNMATCHED_FILE, unmatched.map((u) => `${u.count}\t${u.key}`).join('\n') + '\n')

console.log(`Done: ${Object.keys(forms).length} forms → ${Object.keys(lemmas).length} lemmas`)
console.log(`${unmatched.length} unmatched keys → ${UNMATCHED_FILE}`)
console.log(`Table written to ${OUT_FILE} (${(JSON.stringify(table).length / 1e6).toFixed(1)} MB)`)
