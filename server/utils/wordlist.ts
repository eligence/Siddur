import type { QuizWord, SectionText, TocNode } from '../../shared/types/siddur'

const SIDDUR_TITLE = 'Weekday Siddur Chabad'

function leafRefs(node: TocNode): string[] {
  if (node.children) return node.children.flatMap(leafRefs)
  return node.ref ? [node.ref] : []
}

async function fetchAllTexts(refs: string[], concurrency = 5) {
  const texts: SectionText[] = []
  let failed = false
  let cursor = 0
  async function worker() {
    while (cursor < refs.length) {
      const ref = refs[cursor++]!
      try {
        texts.push(await fetchSefariaText(ref))
      } catch {
        failed = true
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return { texts, failed }
}

export async function buildWordList(): Promise<QuizWord[]> {
  const storage = useStorage('cache')
  const cacheKey = 'sefaria:wordlist:v5'
  const cached = await storage.getItem<QuizWord[]>(cacheKey)
  if (cached) return cached

  const index = await fetchSefariaIndex(SIDDUR_TITLE)
  const { texts, failed } = await fetchAllTexts(leafRefs(buildToc(index.schema)))

  // Pass 1: count every vowelized form and record which bare keys occur on their own.
  const formCounts = new Map<string, number>()
  const standaloneKeys = new Set<string>()
  for (const text of texts) {
    for (const para of text.paragraphs) {
      for (const seg of para.segments) {
        if (seg.type !== 'words') continue
        // A maqaf (־) joins separate words for reading (e.g. עַל֯־פְּנֵי), so count each part.
        for (const raw of seg.words.flatMap((w) => w.split('\u05BE'))) {
          // NFC decomposes presentation forms so prefix detection sees base letters.
          const form = cleanHebrewWord(raw).normalize('NFC')
          const key = normalizeHebrewWord(form)
          // Skip non-Hebrew tokens (e.g. Omer day numbers).
          if (!/^[\u05D0-\u05EA]+$/.test(key)) continue
          standaloneKeys.add(key)
          formCounts.set(form, (formCounts.get(form) ?? 0) + 1)
        }
      }
    }
  }

  // Pass 2: a leading ו ("and") is always folded. Other prefixes (ב/כ/ל/מ/ה) fold
  // into the deepest stem that also appears standalone in the siddur — so
  // וְהַמֶּלֶךְ counts toward מֶלֶךְ, while בָּרוּךְ stays intact because רוּךְ never
  // occurs on its own.
  const entries = new Map<string, { count: number; forms: Map<string, number> }>()
  for (const [form, n] of formCounts) {
    let key = normalizeHebrewWord(form)
    const startsWithVav = key.startsWith('ו')
    hebrewPrefixStems(form).forEach((stem, i) => {
      const stemKey = normalizeHebrewWord(stem)
      if (standaloneKeys.has(stemKey) || (i === 0 && startsWithVav)) key = stemKey
    })
    let entry = entries.get(key)
    if (!entry) {
      entry = { count: 0, forms: new Map() }
      entries.set(key, entry)
    }
    entry.count += n
    entry.forms.set(form, n)
  }

  const result: QuizWord[] = [...entries].map(([key, { count, forms }]) => {
    const sorted = [...forms].sort((a, b) => b[1] - a[1])
    // Display the most frequent unprefixed form; fall back to the most frequent overall.
    const word = (sorted.find(([f]) => normalizeHebrewWord(f) === key) ?? sorted[0]!)[0]
    return { key, word, count, forms: sorted.map(([f]) => f) }
  })
  result.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))

  if (!failed) await storage.setItem(cacheKey, result)
  return result
}
