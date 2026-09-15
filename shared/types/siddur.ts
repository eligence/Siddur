export interface TocNode {
  key: string
  title: string
  heTitle: string
  ref?: string
  children?: TocNode[]
}

export interface SectionParagraph {
  he: string
  en: string | null
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
