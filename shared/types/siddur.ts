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

export interface LexiconResult {
  headword: string
  lexicon: string
  definitions: string[]
}
