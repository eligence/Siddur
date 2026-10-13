import type { PrefixLocation, PrefixReport, PrefixReportRow } from '../../shared/types/siddur'

const MAX_LOCATIONS = 3
const CONTEXT_WORDS = 5
const MAX_MEANING = 80

const shorten = (s: string) => (s.length > MAX_MEANING ? `${s.slice(0, MAX_MEANING).trimEnd()}…` : s)

/**
 * Prefix classification of every siddur form starting with ב/כ/ל/מ/ה/ו/ש, keyed by
 * lexiconKey (the prefix.overrides.json key), with where it occurs. Low-confidence
 * rows first, then by frequency.
 */
export async function buildPrefixReport(): Promise<PrefixReport> {
  const { leaves, texts } = await loadSiddurTexts()
  const formCounts = countForms(texts.values())
  const overrides = await loadPrefixOverrides()
  // Rules only — the override is reported separately so the page can show both.
  const ctx = await createPrefixContext(formCounts.keys(), {})
  const lexicon = await loadLexiconTable()

  const counts = new Map<string, number>()
  for (const [form, n] of formCounts) {
    const key = lexiconKey(form)
    counts.set(key, (counts.get(key) ?? 0) + n)
  }

  const locations = new Map<string, PrefixLocation[]>()
  for (const { top, leaf, ref } of leaves) {
    const text = texts.get(ref)
    if (!text) continue
    const title = top === leaf ? top.title : `${top.title} › ${leaf.title}`
    text.paragraphs.forEach((para, pi) => {
      for (const seg of para.segments) {
        if (seg.type !== 'words') continue
        seg.words.forEach((token, wi) => {
          for (const form of tokenForms(token)) {
            const list = locations.get(lexiconKey(form)) ?? []
            if (list.length >= MAX_LOCATIONS) continue
            list.push({
              ref,
              topKey: top.key,
              title,
              paragraph: pi + 1,
              before: `${wi > CONTEXT_WORDS ? '… ' : ''}${seg.words.slice(Math.max(0, wi - CONTEXT_WORDS), wi).join(' ')}`,
              word: token,
              after: `${seg.words.slice(wi + 1, wi + 1 + CONTEXT_WORDS).join(' ')}${wi + 1 + CONTEXT_WORDS < seg.words.length ? ' …' : ''}`,
            })
            locations.set(lexiconKey(form), list)
          }
        })
      }
    })
  }

  const rows: PrefixReportRow[] = []
  for (const [word, count] of counts) {
    const a = classifyPrefix(word, ctx)
    if (!a.classification) continue
    const top = topLexiconEntry(lexicon, a.base) ?? topLexiconEntry(lexicon, word)
    rows.push({
      word,
      count,
      auto: a.classification,
      override: overrides[word] ?? null,
      base: a.base,
      headword: top?.headword ?? null,
      meaning: top?.definitions[0] ? shorten(top.definitions[0]) : null,
      function: a.function,
      reason: a.reason,
      confident: a.confident,
      locations: locations.get(word) ?? [],
    })
  }
  rows.sort((x, y) => Number(x.confident) - Number(y.confident) || y.count - x.count)
  return { rows, editable: prefixOverridesEditable }
}
