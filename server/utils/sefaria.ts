import type { HebrewSegment, SectionParagraph, SectionText, TocNode } from '../../shared/types/siddur'

const SEFARIA_BASE = 'https://www.sefaria.org'

export interface SefariaSchemaNode {
  key: string
  title?: string
  heTitle?: string
  nodes?: SefariaSchemaNode[]
  nodeType?: string
}

export interface SefariaIndexResponse {
  title: string
  schema: SefariaSchemaNode
}

/** Fetch the raw Index (v2) record for a title and cache it in Nitro storage. */
export async function fetchSefariaIndex(title: string): Promise<SefariaIndexResponse> {
  const storage = useStorage('cache')
  const cacheKey = `sefaria:index:${title}`
  const cached = await storage.getItem<SefariaIndexResponse>(cacheKey)
  if (cached) return cached

  const data = await $fetch<SefariaIndexResponse>(
    `${SEFARIA_BASE}/api/v2/index/${encodeURIComponent(title)}`,
  )
  await storage.setItem(cacheKey, data)
  return data
}

/** Recursively convert a Sefaria schema tree into a simplified TOC tree with resolved refs. */
export function buildToc(node: SefariaSchemaNode, parentKeys: string[] = []): TocNode {
  const path = [...parentKeys, node.key]
  const title = node.title ?? node.key
  const heTitle = node.heTitle ?? ''

  if (node.nodes && node.nodes.length > 0) {
    return {
      key: node.key,
      title,
      heTitle,
      children: node.nodes.map((child) => buildToc(child, path)),
    }
  }

  return {
    key: node.key,
    title,
    heTitle,
    ref: path.join(', '),
  }
}

/** Split a paragraph's raw Hebrew HTML into non-interactive "note" (<small>) segments and tokenized "words" segments. */
export function parseHebrewSegments(html: string): HebrewSegment[] {
  const segments: HebrewSegment[] = []
  const smallRegex = /<small>([\s\S]*?)<\/small>/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  const pushWords = (chunk: string) => {
    const text = chunk
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .trim()
    const words = text.split(/\s+/).filter(Boolean)
    if (words.length) segments.push({ type: 'words', words })
  }

  while ((match = smallRegex.exec(html))) {
    if (match.index > lastIndex) pushWords(html.slice(lastIndex, match.index))
    segments.push({ type: 'note', html: (match[1] ?? '').trim() })
    lastIndex = smallRegex.lastIndex
  }
  if (lastIndex < html.length) pushWords(html.slice(lastIndex))

  return segments
}

interface SefariaVersionEntry {
  language: string
  versionTitle: string
  text: string[]
}

interface SefariaV3TextsResponse {
  ref: string
  title: string
  heTitle: string
  versions: SefariaVersionEntry[]
}

/** Fetch bilingual text for a given ref and cache it in Nitro storage. */
export async function fetchSefariaText(ref: string): Promise<SectionText> {
  const storage = useStorage('cache')
  const cacheKey = `sefaria:text:${ref}`
  const cached = await storage.getItem<SectionText>(cacheKey)
  if (cached) return cached

  const data = await $fetch<SefariaV3TextsResponse>(
    `${SEFARIA_BASE}/api/v3/texts/${encodeURIComponent(ref)}`,
    { query: { version: ['hebrew', 'english'] } },
  )

  const heVersion = data.versions.find((v) => v.language === 'he')
  const enVersion = data.versions.find((v) => v.language === 'en')

  const heLines = heVersion?.text ?? []
  const enLines = enVersion?.text ?? []

  const stripTags = (value: string) => value.replace(/<[^>]+>/g, '').trim()

  let hasTranslation = false
  const paragraphs: SectionParagraph[] = heLines.map((he, i) => {
    const rawEn = enLines[i]
    // The community translation sometimes leaves an entry blank or duplicates the Hebrew
    // source (often missing the Hebrew's <b>/<small> markup) when untranslated; compare
    // tag-stripped text so those duplicates are still treated as "no translation".
    const en = rawEn && stripTags(rawEn) && stripTags(rawEn) !== stripTags(he) ? rawEn : null
    if (en) hasTranslation = true
    return { he, en, segments: parseHebrewSegments(he) }
  })

  const result: SectionText = {
    ref: data.ref,
    title: data.title,
    heTitle: data.heTitle,
    paragraphs,
    hasTranslation,
  }

  await storage.setItem(cacheKey, result)
  return result
}
