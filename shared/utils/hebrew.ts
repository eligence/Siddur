/** Strip Hebrew/English punctuation so words like בְּרֵאשִׁית and בְּרֵאשִׁית, share the same key. */
export function normalizeHebrewWord(word: string): string {
  // NFKD splits presentation forms (e.g. בּ U+FB31) into base letter + mark.
  return word.normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '')
}

// Trim leading/trailing punctuation and symbols — including Hebrew-block punctuation
// like maqaf (U+05BE), paseq (U+05C0), sof pasuq (U+05C3) and geresh/gershayim
// (U+05F3-4), which can end up merged onto word edges — while keeping letters and
// niqqud/cantillation marks intact so the lexicon can match vowelized forms.
const EDGE_PUNCTUATION = /^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu

export function cleanHebrewWord(word: string): string {
  return word.replace(EDGE_PUNCTUATION, '')
}

const SHEVA = '\u05B0'
const HATAF_SEGOL = '\u05B1'
const HATAF_PATACH = '\u05B2'
const HATAF_QAMATS = '\u05B3'
const HIRIQ = '\u05B4'
const TSERE = '\u05B5'
const SEGOL = '\u05B6'
const PATACH = '\u05B7'
const QAMATS = '\u05B8'
const DAGESH = '\u05BC'
const VOWELS = /[\u05B0-\u05BB\u05C7]/
const GUTTURALS_RESH = 'אהחער'

interface Cluster {
  letter: string
  marks: string
  text: string
}

/** Split a vowelized word into letter + niqqud clusters. */
function toClusters(word: string): Cluster[] {
  const out: Cluster[] = []
  for (const ch of word) {
    const last = out[out.length - 1]
    if (/\p{L}/u.test(ch)) out.push({ letter: ch, marks: '', text: ch })
    else if (last) {
      if (/\p{M}/u.test(ch)) last.marks += ch
      last.text += ch
    }
  }
  return out
}

const has = (c: Cluster, mark: string) => c.marks.includes(mark)

/** Vav-conjunctive ("and"): a leading ו is always treated as the "and" prefix. */
function isConjunction(c: Cluster) {
  return c.letter === 'ו'
}

/** Inseparable prepositions ב/כ/ל, pointed per the standard rules (incl. absorbed article). */
function isPreposition(c: Cluster, n: Cluster) {
  if (!'בכל'.includes(c.letter)) return false
  if (has(c, SHEVA)) return true
  if (has(c, HIRIQ)) return has(n, SHEVA) || (n.letter === 'י' && !VOWELS.test(n.marks))
  if (has(c, PATACH)) return has(n, DAGESH) || GUTTURALS_RESH.includes(n.letter) || has(n, HATAF_PATACH)
  if (has(c, QAMATS)) return has(n, DAGESH) || GUTTURALS_RESH.includes(n.letter) || has(n, HATAF_QAMATS)
  if (has(c, TSERE)) return n.letter === 'א'
  if (has(c, SEGOL)) return has(n, HATAF_SEGOL)
  return false
}

/** מ ("from"): מִ + dagesh forte, or מֵ before gutturals/ר. */
function isFromPrefix(c: Cluster, n: Cluster) {
  if (c.letter !== 'מ') return false
  if (has(c, HIRIQ)) return has(n, DAGESH) || n.letter === 'י'
  if (has(c, TSERE)) return GUTTURALS_RESH.includes(n.letter)
  return false
}

/** Definite article ה (and interrogative הֲ). */
function isArticle(c: Cluster, n: Cluster) {
  if (c.letter !== 'ה') return false
  if (has(c, PATACH)) return has(n, DAGESH) || 'הח'.includes(n.letter)
  if (has(c, QAMATS)) return GUTTURALS_RESH.includes(n.letter)
  if (has(c, SEGOL)) return 'החע'.includes(n.letter)
  return has(c, HATAF_PATACH)
}

/**
 * Candidate stems of a vowelized word after peeling formative-letter prefixes in
 * order: [ו] → [ב/כ/ל or מ] → [ה]. Returned shallowest first; each stem keeps at
 * least two letters. Callers should verify stems (e.g. against a corpus), since
 * pointing alone can't always distinguish a prefix from a root letter.
 */
export function hebrewPrefixStems(word: string): string[] {
  const cs = toClusters(word)
  const stems: string[] = []
  let i = 0
  const step = (test: (c: Cluster, n: Cluster) => boolean) => {
    if (cs.length - i < 3 || !test(cs[i]!, cs[i + 1]!)) return false
    i++
    stems.push(cs.slice(i).map((c) => c.text).join(''))
    return true
  }
  step(isConjunction)
  if (!step(isPreposition)) step(isFromPrefix)
  step(isArticle)
  return stems
}
