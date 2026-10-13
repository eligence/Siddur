import type { PrefixClass } from '../utils/hebrew'

export interface TocNode {
  key: string
  title: string
  heTitle: string
  ref?: string
  children?: TocNode[]
}

/**
 * A chunk of a paragraph's Hebrew content.
 * "note" segments are instructional text (originally wrapped in <small>...</small> by
 * Sefaria) and are excluded from the word-input/translation-check learning features.
 * "words" segments are the actual prayer text, tokenized for per-word interaction.
 */
export type HebrewSegment =
  | { type: 'note'; html: string }
  | { type: 'words'; words: string[] }

export interface SectionParagraph {
  he: string
  en: string | null
  segments: HebrewSegment[]
}

export interface SectionText {
  ref: string
  title: string
  heTitle: string
  paragraphs: SectionParagraph[]
  hasTranslation: boolean
}

export interface SiddurTocResponse {
  title: string
  sections: TocNode[]
}

export interface QuizWord {
  key: string
  word: string
  count: number
  /** Every vowelized form (incl. prefixed) folded into this entry, most frequent first. */
  forms: string[]
}

export interface PrefixLocation {
  /** Leaf section ref and its top-level TOC key (for the /siddur/<slug>#section link). */
  ref: string
  topKey: string
  title: string
  /** 1-based paragraph within the section. */
  paragraph: number
  before: string
  word: string
  after: string
}

export interface PrefixReportRow {
  /** lexiconKey(form) — also the key in prefix.overrides.json. */
  word: string
  count: number
  /** Classification by the rules alone (ignoring overrides). */
  auto: PrefixClass
  override: PrefixClass | null
  base: string
  headword: string | null
  meaning: string | null
  function: string
  reason: string
  confident: boolean
  locations: PrefixLocation[]
}

export interface PrefixReport {
  rows: PrefixReportRow[]
  /** Overrides can be saved (dev server only — they're written to server/assets). */
  editable: boolean
}

export interface LexiconResult {
  headword: string
  lexicon: string
  definitions: string[]
}
