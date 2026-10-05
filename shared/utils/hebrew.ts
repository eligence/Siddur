/** Strip Hebrew/English punctuation so words like בְּרֵאשִׁית and בְּרֵאשִׁית, share the same key. */
export function normalizeHebrewWord(word: string): string {
  return word.replace(/[^\p{L}\p{N}]/gu, '')
}

// Trim leading/trailing punctuation and symbols — including Hebrew-block punctuation
// like maqaf (U+05BE), paseq (U+05C0), sof pasuq (U+05C3) and geresh/gershayim
// (U+05F3-4), which can end up merged onto word edges — while keeping letters and
// niqqud/cantillation marks intact so the lexicon can match vowelized forms.
const EDGE_PUNCTUATION = /^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu

export function cleanHebrewWord(word: string): string {
  return word.replace(EDGE_PUNCTUATION, '')
}
