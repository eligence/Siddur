import type { QuizWord, SectionText, TocNode } from '../../shared/types/siddur'
import { consonantalKey } from '../../shared/utils/hebrew'
import type { PrefixContext, PrefixOverrides } from '../../shared/utils/hebrew'
import { loadLexiconTable, topLexiconEntry } from './lexicon'

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
  const cacheKey = `sefaria:wordlist:v19:${overridesFingerprint(overrides)}`
  const cached = await storage.getItem<QuizWord[]>(cacheKey)
  if (cached) return cached

  const { texts, failed } = await loadSiddurTexts()
  const formCounts = countForms(texts.values())

  // Prefixes (ו/שֶׁ/ב/כ/ל/מ/ה) are stripped per classifyPrefix — pointing, the
  // form's lexicon headword, whether the remainder occurs on its own in the siddur, and
  // prefix.overrides.json — so בְּצֶלֶם folds into צלם, while בָּרוּךְ (ברך) and לְבָבִי (לבב) stay intact.
  const prefixCtx = await createPrefixContext(formCounts.keys(), overrides)

  /**
   * Derive a triliteral shoresh from a consonantal string. Handles common
   * affixes that add letters around the three root consonants:
   * - final ה/ת (feminine/abstract noun)
   * - internal ו/י connecting vowels
   * - leading binyan prefixes (ה/נ/י/ת/א/מ, including hitpael תת)
   */
  function triliteralRoot(s: string): string | null {
    let r = consonantalKey(s)
    if (r.length === 3) return r
    if (r.length === 4) {
      if (r.endsWith('ה') || r.endsWith('ת')) {
        r = r.slice(0, -1)
        if (r.length === 3) return r
      }
      const withoutVav = r.replace(/ו/g, '')
      if (withoutVav.length === 3) return withoutVav
      const withoutYod = r.replace(/י/g, '')
      if (withoutYod.length === 3) return withoutYod
    }
    if (r.length >= 4 && r.length <= 6) {
      for (const pre of ['תת', 'הת', 'נת', 'ית', 'מ', 'ה', 'נ', 'י', 'ת', 'א']) {
        if (r.startsWith(pre)) {
          const rest = r.slice(pre.length)
          if (rest.length === 3) return rest
        }
      }
    }
    return null
  }

  function shoreshFor(base: string): { key: string; display: string | null } {
    const baseKey = normalizeHebrewWord(base)
    // 1. Prefer a triliteral root derived from the Sefaria headword when available
    // (e.g. בָּרוּךְ → ברך, חָבִיב → חבב).
    const top = topLexiconEntry(lexicon, base)
    if (top) {
      const headRoot = triliteralRoot(top.headword)
      if (headRoot) {
        return { key: normalizeHebrewWord(headRoot), display: top.headword }
      }
    }
    // 2. Derive a root from the prefix-stripped base itself. We avoid the
    // cached model stems here: they are often wrong for particles and short
    // forms (e.g. כִּי → עימך, חָבִיב → חיב).
    const baseRoot = triliteralRoot(base)
    if (baseRoot) {
      return { key: normalizeHebrewWord(baseRoot), display: null }
    }
    return { key: baseKey, display: null }
  }

  type Entry = { count: number; forms: Map<string, number>; formBase: Map<string, string>; prefixForms: Set<string>; shoreshDisplay: string | null }
  const entries = new Map<string, Entry>()
  for (const [form, n] of formCounts) {
    const analysis = classifyPrefix(form, prefixCtx)
    const base = analysis.base
    const { key, display } = shoreshFor(base)
    let entry = entries.get(key)
    if (!entry) {
      entry = { count: 0, forms: new Map(), formBase: new Map(), prefixForms: new Set(), shoreshDisplay: display }
      entries.set(key, entry)
    }
    entry.count += n
    entry.forms.set(form, n)
    entry.formBase.set(form, base)
    if (analysis.classification === 'prefix') entry.prefixForms.add(form)
  }

  const result: QuizWord[] = [...entries].map(([key, { count, forms, formBase, prefixForms, shoreshDisplay }]) => {
    const sorted = [...forms].sort((a, b) => b[1] - a[1])
    // Prefer a surface form whose consonantal key matches the shoresh. If none,
    // prefer any unprefixed surface form so the headword is a readable Hebrew
    // word rather than a prefixed form. As a last resort, strip a separable
    // prefix or use a known pointed headword / the most frequent surface form.
    const rootForm = sorted.find(([f]) => normalizeHebrewWord(f) === key)
    const unprefixed = sorted.find(([f]) => !prefixForms.has(f))
    const prefixFallback = sorted.find(([f]) => prefixForms.has(f))
    const word = rootForm
      ? rootForm[0]
      : unprefixed
        ? unprefixed[0]
        : prefixFallback
          ? formBase.get(prefixFallback[0])!
          : shoreshDisplay || sorted[0]![0]
    return { key, word, count, forms: sorted.map(([f]) => f) }
  })
  result.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))

  if (!failed) await storage.setItem(cacheKey, result)
  return result
}
