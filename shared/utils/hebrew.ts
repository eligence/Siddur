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
  if (has(c, SEGOL)) return 'החע'.includes(n.letter) && (has(n, QAMATS) || has(n, HATAF_QAMATS))
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

/** שֶׁ ("that/who"): segol + dagesh in the next letter, or before a guttural/ר. Lookup-only. */
function isRelative(c: Cluster, n: Cluster) {
  return c.letter === 'ש' && has(c, SEGOL) && (has(n, DAGESH) || GUTTURALS_RESH.includes(n.letter))
}

/**
 * Canonical lexicon key for a word: edge punctuation trimmed, NFC (which also
 * decomposes presentation forms), and cantillation/meteg/masoretic marks removed —
 * letters, vowels, dagesh and shin/sin dots are kept.
 */
export function lexiconKey(word: string): string {
  return cleanHebrewWord(word)
    .normalize('NFC')
    .replace(/[\u0591-\u05AF\u05BD\u05BF\u05C0\u05C3-\u05C6]/g, '')
}

const TO_MEDIAL: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' }
const TO_FINAL: Record<string, string> = { כ: 'ך', מ: 'ם', נ: 'ן', פ: 'ף', צ: 'ץ' }

/** Replace final letter forms (ך ם ן ף ץ) with their medial forms. */
export function foldFinals(s: string): string {
  return s.replace(/[ךםןףץ]/g, (c) => TO_MEDIAL[c]!)
}

function withFinal(s: string): string {
  const last = s.slice(-1)
  return TO_FINAL[last] ? s.slice(0, -1) + TO_FINAL[last] : s
}

/** Bare consonants of a (vowelized) headword, final letters folded — for root comparison. */
export function consonantalKey(s: string): string {
  return foldFinals(normalizeHebrewWord(s).replace(/[^\u05D0-\u05EA]/g, ''))
}

// Medial-letter spellings (keys are final-folded). Longest first so e.g. ־ֵיכֶם
// is tried before ־ם. Covers perfect-tense endings, future/imperative endings,
// pronominal suffixes on nouns/verbs, and plural endings.
const SUFFIXES = [
  'יכמ', 'יכנ', 'יהמ', 'יהנ', 'ינו',
  'תמ', 'תנ', 'תי', 'נו', 'יכ', 'יו', 'יה', 'כמ', 'כנ', 'המ', 'הנ', 'הו', 'ימ', 'ות', 'נה', 'ית',
  'ת', 'ו', 'ה', 'כ', 'מ', 'נ', 'י',
]
// Hif'il/nif'al ה/נ, future-tense א/י/נ/ת, participle מ.
const PREFIXES = ['ה', 'נ', 'י', 'ת', 'א', 'מ']

/** 3-letter root guesses (final letters restored) for a consonantal key, with edit costs. */
function rootGuesses(key: string, out: Map<string, number>) {
  const add = (r: string, cost: number, noun = false) => {
    if (noun ? r.length < 3 || r.length > 5 : r.length !== 3) return
    const root = withFinal(r)
    if (!out.has(root) || out.get(root)! > cost) out.set(root, cost)
  }
  for (const suf of ['', ...SUFFIXES]) {
    if (suf && !key.endsWith(suf)) continue
    const noSuf = key.slice(0, key.length - suf.length)
    for (const pre of ['', ...PREFIXES]) {
      if (pre && !noSuf.startsWith(pre)) continue
      const r = noSuf.slice(pre.length)
      const cost = (suf ? 1 : 0) + (pre ? 1 : 0)
      // Noun base under a pronominal suffix; construct ת restores to ה (תּוֹרָתְךָ → תורה).
      if (suf && !pre && r.length > 3) {
        add(r, cost, true)
        if (r.endsWith('ת')) add(r.slice(0, -1) + 'ה', cost, true)
      }
      const variants: [string, number][] = [[r, cost]]
      // Hif'il י before the last root letter (הֶחֱזִיר); qal participle ו (חוֹזֵר).
      if (r.length === 4 && r[2] === 'י') variants.push([r.slice(0, 2) + r[3], cost + 1])
      if (r.length === 4 && r[1] === 'ו') variants.push([r[0] + r.slice(2), cost + 1])
      for (const [v, c] of variants) {
        if (v.length === 3) {
          if (c > 0) add(v, c)
          // פ״י: hif'il/nif'al ו stands for the root's י (הוֹשִׁיעַ → ישע).
          if (v[0] === 'ו') add('י' + v.slice(1), c + 1)
          // ל״ה: -ִית / -ִינוּ / feminine ת stand for a final ה (עָשִׂיתָ → עשה).
          if (v[2] === 'י' || v[2] === 'ת') add(v.slice(0, 2) + 'ה', c + 1)
        } else if (v.length === 2) {
          // Two letters left: restore the weak letter.
          add(v[0] + 'ו' + v[1], c + 1) // hollow ע״ו (קַמְתִּי → קום)
          add(v[0] + 'י' + v[1], c + 1) // hollow ע״י
          add(v + 'ה', c + 1) // ל״ה
          add('נ' + v, c + 1) // פ״נ (תִּתֵּן → נתן)
          add('י' + v, c + 1) // פ״י (תֵּשֵׁב → ישב)
          add(v + v[1], c + 1) // geminate ע״ע (סַבּוֹתָ → סבב)
        }
      }
    }
  }
}

export interface LookupCandidate {
  query: string
  /** A guessed consonantal root: results must be verified against its headword. */
  root: boolean
}

/**
 * Fallback lexicon lookup forms for a vowelized word, most specific first:
 * שֶׁ-stripped form → prefix stems (deepest first) → 3-letter root guesses ranked
 * by edit count (suffix/prefix removal, hif'il/participle matres, weak-letter
 * restoration). Root guesses are tagged so callers can verify the headword.
 */
export function lexiconLookupCandidates(word: string, max = 12): LookupCandidate[] {
  const forms = new Set<string>()
  const cs = toClusters(word)
  let base = word
  if (cs.length >= 3 && isRelative(cs[0]!, cs[1]!)) {
    base = cs.slice(1).map((c) => c.text).join('')
    forms.add(base)
  }
  const stems = hebrewPrefixStems(base).reverse()
  stems.forEach((s) => forms.add(s))
  forms.delete(word)

  const roots = new Map<string, number>()
  for (const s of [...stems, base]) rootGuesses(foldFinals(normalizeHebrewWord(s)), roots)
  const rankedRoots = [...roots].sort((a, b) => a[1] - b[1]).map(([r]) => r)

  return [
    ...[...forms].map((query) => ({ query, root: false })),
    ...rankedRoots.map((query) => ({ query, root: true })),
  ].slice(0, max)
}
