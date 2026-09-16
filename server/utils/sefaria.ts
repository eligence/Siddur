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

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u
const OPENING_PUNCT = /^[\p{Ps}\p{Pi}]+$/u
const CLOSING_PUNCT = /^[\p{Pe}\p{Pf}]+$/u

/**
 * Merge tokens that are only punctuation into neighboring words so they don't
 * render as their own clickable .word-he button. Opening brackets/quotes attach
 * to the NEXT word ("(word"), everything else (sof pasuq, periods, closing
 * brackets…) to the previous one ("word)"). At a words-segment boundary the
 * merge crosses into the next/previous words segment — note segments are never
 * touched, EXCEPT a bracket pair wrapping a note ("( <small>note</small> )"),
 * which merges into the note so the whole parenthetical renders in note style.
 */
function mergePunctuationTokens(segments: HebrewSegment[]) {
  // Bracket pair wrapping a note: fold both into the note's HTML.
  for (let si = 0; si + 2 < segments.length; si++) {
    const before = segments[si]!
    const note = segments[si + 1]!
    const after = segments[si + 2]!
    if (before.type !== 'words' || note.type !== 'note' || after.type !== 'words') continue
    const open = before.words[before.words.length - 1]
    const close = after.words[0]
    if (open && close && OPENING_PUNCT.test(open) && CLOSING_PUNCT.test(close)) {
      note.html = open + note.html + close
      before.words.pop()
      after.words.shift()
    }
  }

  const appendToPrev = (segIdx: number, token: string): boolean => {
    for (let k = segIdx - 1; k >= 0; k--) {
      const seg = segments[k]!
      if (seg.type === 'words' && seg.words.length) {
        seg.words[seg.words.length - 1] += token
        return true
      }
    }
    return false
  }

  const prependToNext = (segIdx: number, token: string): boolean => {
    for (let k = segIdx + 1; k < segments.length; k++) {
      const seg = segments[k]!
      if (seg.type === 'words' && seg.words.length) {
        seg.words[0] = token + seg.words[0]
        return true
      }
    }
    return false
  }

  segments.forEach((seg, si) => {
    if (seg.type !== 'words') return
    const merged: string[] = []
    const words = seg.words
    for (let i = 0; i < words.length; i++) {
      const word = words[i]!
      if (LETTER_OR_DIGIT.test(word)) {
        merged.push(word)
        continue
      }
      const hasNext = i + 1 < words.length
      if (OPENING_PUNCT.test(word)) {
        if (hasNext) words[i + 1] = word + words[i + 1]!
        else if (!prependToNext(si, word)) {
          if (merged.length) merged[merged.length - 1] += word
          else merged.push(word)
        }
      } else if (merged.length) {
        merged[merged.length - 1] += word
      } else if (!appendToPrev(si, word)) {
        if (hasNext) words[i + 1] = word + words[i + 1]!
        else merged.push(word)
      }
    }
    seg.words = merged
  })
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

  mergePunctuationTokens(segments)
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
  // v6: punctuation-only tokens merge into neighboring words, crossing segment
  // boundaries; a bracket pair wrapping a note merges into the note itself.
  const cacheKey = `sefaria:text:v6:${ref}`
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
