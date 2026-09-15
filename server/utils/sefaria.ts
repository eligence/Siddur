import type { SectionParagraph, SectionText, TocNode } from '../../shared/types/siddur'

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

  let hasTranslation = false
  const paragraphs: SectionParagraph[] = heLines.map((he, i) => {
    const rawEn = enLines[i]
    // The community translation sometimes leaves an entry blank or duplicates
    // the Hebrew source when untranslated; treat those cases as "no translation".
    const en = rawEn && rawEn.trim() && rawEn.trim() !== he.trim() ? rawEn : null
    if (en) hasTranslation = true
    return { he, en }
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
