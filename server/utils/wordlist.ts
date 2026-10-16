import type { QuizWord, SectionText, TocNode } from '../../shared/types/siddur'
import { lexiconKey } from '../../shared/utils/hebrew'
import type { PrefixContext, PrefixOverrides } from '../../shared/utils/hebrew'
import { loadLexiconTable } from './lexicon'

const SIDDUR_TITLE = 'Weekday Siddur Chabad'

export interface SiddurLeaf {
  /** Top-level TOC node (one /siddur/<slug> page). */
  top: TocNode
  leaf: TocNode
  ref: string
}

function leafNodes(node: TocNode): TocNode[] {
  if (node.children) return node.children.flatMap(leafNodes)
  return node.ref ? [node] : []
}

/** Every leaf section of the siddur in order, with its text (missing if the fetch failed). */
export async function loadSiddurTexts(concurrency = 5) {
  const index = await fetchSefariaIndex(SIDDUR_TITLE)
  const tops = buildToc(index.schema).children ?? []
  const leaves: SiddurLeaf[] = tops.flatMap((top) => leafNodes(top).map((leaf) => ({ top, leaf, ref: leaf.ref! })))
  const texts = new Map<string, SectionText>()
  let failed = false
  let cursor = 0
  async function worker() {
    while (cursor < leaves.length) {
      const { ref } = leaves[cursor++]!
      try {
        texts.set(ref, await fetchSefariaText(ref))
      } catch {
        failed = true
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return { leaves, texts, failed }
}

/** The Hebrew word forms of a words-segment token, as counted by the word list (or [] for non-Hebrew). */
export function tokenForms(token: string): string[] {
  // A maqaf (־) joins separate words for reading (e.g. עַל֯־פְּנֵי), so count each part.
  // NFC decomposes presentation forms so prefix detection sees base letters.
  return token
    .split('\u05BE')
    .map((raw) => cleanHebrewWord(raw).normalize('NFC'))
    // Skip non-Hebrew tokens (e.g. Omer day numbers).
    .filter((form) => /^[\u05D0-\u05EA]+$/.test(normalizeHebrewWord(form)))
}

/** Count every vowelized form. */
export function countForms(texts: Iterable<SectionText>): Map<string, number> {
  const formCounts = new Map<string, number>()
  for (const text of texts) {
    for (const para of text.paragraphs) {
      for (const seg of para.segments) {
        if (seg.type !== 'words') continue
        for (const form of seg.words.flatMap(tokenForms)) formCounts.set(form, (formCounts.get(form) ?? 0) + 1)
      }
    }
  }
  return formCounts
}

/** classifyPrefix context: lexicon headwords + the siddur's own forms as known stems. */
export async function createPrefixContext(forms: Iterable<string>, overrides: PrefixOverrides): Promise<PrefixContext> {
  const lexicon = await loadLexiconTable()
  return {
    isKnownStem: knownStemChecker(forms),
    headword: (form) => {
      const top = topLexiconEntry(lexicon, form)
      return top ? consonantalKey(top.headword) : ''
    },
    overrides,
  }
}

export async function buildWordList(): Promise<QuizWord[]> {
  const storage = useStorage('cache')
  const overrides = await loadPrefixOverrides()
  const lexicon = await loadLexiconTable()
  const cacheKey = `sefaria:wordlist:v12:${overridesFingerprint(overrides)}`
  const cached = await storage.getItem<QuizWord[]>(cacheKey)
  if (cached) return cached

  const { texts, failed } = await loadSiddurTexts()
  const formCounts = countForms(texts.values())

  // Prefixes (ו/שֶׁ/ב/כ/ל/מ/ה) are stripped per classifyPrefix — pointing, the
  // form's lexicon headword, whether the remainder occurs on its own in the siddur, and
  // prefix.overrides.json — so בְּצֶלֶם folds into צלם, while בָּרוּךְ (ברך) and לְבָבִי (לבב) stay intact.
  const prefixCtx = await createPrefixContext(formCounts.keys(), overrides)
  type Entry = { count: number; forms: Map<string, number>; formBase: Map<string, string>; prefixForms: Set<string>; lemmaQuery: string | null }
  const entries = new Map<string, Entry>()
  for (const [form, n] of formCounts) {
    const analysis = classifyPrefix(form, prefixCtx)
    const base = analysis.base
    const baseKey = normalizeHebrewWord(base)
    const lemmaQuery = lexicon?.forms[lexiconKey(base)] || null
    const key = lemmaQuery ? normalizeHebrewWord(lemmaQuery) : baseKey
    let entry = entries.get(key)
    if (!entry) {
      entry = { count: 0, forms: new Map(), formBase: new Map(), prefixForms: new Set(), lemmaQuery }
      entries.set(key, entry)
    }
    entry.count += n
    entry.forms.set(form, n)
    entry.formBase.set(form, base)
    if (analysis.classification === 'prefix') entry.prefixForms.add(form)
  }

  const result: QuizWord[] = [...entries].map(([key, { count, forms, formBase, prefixForms, lemmaQuery }]) => {
    const sorted = [...forms].sort((a, b) => b[1] - a[1])
    // Prefer a surface form matching the lemma key. If none exists, strip a
    // separable prefix from the most frequent prefixed form. As a last resort,
    // show the lemma itself (for model/lexicon-derived groupings) or the most
    // frequent surface form.
    const lemmaForm = sorted.find(([f]) => normalizeHebrewWord(f) === key)
    const prefixFallback = !lemmaForm && sorted.find(([f]) => prefixForms.has(f))
    const word = lemmaForm
      ? lemmaForm[0]
      : prefixFallback
        ? formBase.get(prefixFallback[0])!
        : lemmaQuery || sorted[0]![0]
    return { key, word, count, forms: sorted.map(([f]) => f) }
  })
  result.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))

  if (!failed) await storage.setItem(cacheKey, result)
  return result
}
