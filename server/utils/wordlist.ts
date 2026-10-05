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
  const cacheKey = 'sefaria:wordlist:v1'
  const cached = await storage.getItem<QuizWord[]>(cacheKey)
  if (cached) return cached

  const index = await fetchSefariaIndex(SIDDUR_TITLE)
  const { texts, failed } = await fetchAllTexts(leafRefs(buildToc(index.schema)))

  const entries = new Map<string, { count: number; forms: Map<string, number> }>()
  for (const text of texts) {
    for (const para of text.paragraphs) {
      for (const seg of para.segments) {
        if (seg.type !== 'words') continue
        for (const raw of seg.words) {
          const form = cleanHebrewWord(raw)
          const key = normalizeHebrewWord(form)
          if (!key) continue
          let entry = entries.get(key)
          if (!entry) {
            entry = { count: 0, forms: new Map() }
            entries.set(key, entry)
          }
          entry.count++
          entry.forms.set(form, (entry.forms.get(form) ?? 0) + 1)
        }
      }
    }
  }

  const result: QuizWord[] = [...entries].map(([key, { count, forms }]) => {
    let word = ''
    let best = 0
    for (const [form, n] of forms) {
      if (n > best) {
        word = form
        best = n
      }
    }
    return { key, word, count }
  })
  result.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))

  if (!failed) await storage.setItem(cacheKey, result)
  return result
}
