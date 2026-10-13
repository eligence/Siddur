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

// --- Prefix classification ------------------------------------------------------

/**
 * prefix: a separable grammatical prefix (ו ש ב כ ל מ ה).
 * root: the letter belongs to the word itself.
 * formative: a verb-pattern / participle letter (הִתְ־, הִ־, מְ־) — part of the word's form.
 */
export type PrefixClass = 'prefix' | 'root' | 'formative'
/** Manual decisions, keyed by lexiconKey(form). */
export type PrefixOverrides = Record<string, PrefixClass>

export interface PrefixContext {
  /** Whether a stem occurs as an independent word (e.g. elsewhere in the siddur). */
  isKnownStem?: (stem: string) => boolean
  /** Consonantal key of a form's top dictionary headword, or '' if unknown. */
  headword?: (form: string) => string
  overrides?: PrefixOverrides
}

export interface PrefixStep {
  letter: string
  function: string
  reason: string
  confident: boolean
}

export interface PrefixAnalysis {
  word: string
  /** Classification of the first letter; null when it isn't a prefix letter. */
  classification: PrefixClass | null
  /** Peeled prefixes, outermost first. */
  steps: PrefixStep[]
  /** The form left after all peeled prefixes. */
  stem: string
  /** Grouping form: the stem, or — if only a pronoun suffix is left (לְךָ) — the form before the last peel. */
  base: string
  function: string
  reason: string
  confident: boolean
}

const PREFIX_FUNCTION: Record<string, string> = {
  ו: 'Conjunction "and"',
  ש: 'Relative pronoun "that/which/who"',
  ב: 'Preposition "in/at/with"',
  כ: 'Preposition "like/as"',
  ל: 'Preposition "to/for"',
  מ: 'Preposition "from"',
  ה: 'Definite article "the"',
}
// Preposition ב/ל carrying only a pronoun suffix (final letters folded).
const PRONOUN_FORMS = new Set([
  'לי', 'לכ', 'לו', 'לה', 'לנו', 'לכמ', 'לכנ', 'להמ', 'להנ',
  'בי', 'בכ', 'בו', 'בה', 'בנו', 'בכמ', 'בכנ', 'בהמ', 'בהנ', 'במ',
])
const DIVINE_NAMES = new Set(['יי', 'יהוה'])
const POINTING = /[\u05B0-\u05BC\u05C1\u05C2\u05C7]/

/** Comparison key for stems: vowels kept, dagesh dropped (prefixes add/remove it). */
function stemKey(s: string): string {
  return lexiconKey(s).replace(/[\u05BC\u05BF]/g, '').replace(/\u05C7/g, QAMATS).replace(/\u05BA/g, '\u05B9')
}

/** isKnownStem for PrefixContext from a corpus of word forms (pointed stems match by vowels, unpointed by letters). */
export function knownStemChecker(forms: Iterable<string>): (stem: string) => boolean {
  const pointed = new Set<string>()
  const bare = new Set<string>()
  for (const f of forms) {
    pointed.add(stemKey(f))
    bare.add(consonantalKey(f))
  }
  return (stem) => (POINTING.test(stem) ? pointed.has(stemKey(stem)) : bare.has(consonantalKey(stem)))
}

/** Root-letter count of a stem: consonants minus one plural/feminine ending (ים / ות / ה). */
function baseConsonants(s: string): number {
  const k = consonantalKey(s)
  const trimmed = k.replace(/(ימ|ות|ה)$/, '')
  return (trimmed.length >= 2 ? trimmed : k).length
}

// Prefix slots, outermost first: ו → כ/מ (before שֶׁ) → שֶׁ → ב/כ/ל/מ → ה.
function prefixStage(cs: Cluster[], i: number, from: number, pointed: boolean): number {
  const c = cs[i]!.letter
  if (from <= 0 && c === 'ו') return 0
  if (from <= 1 && 'כמ'.includes(c) && cs[i + 1]?.letter === 'ש' && cs[i + 2]) {
    if (!pointed || isRelative(cs[i + 1]!, cs[i + 2]!)) return 1
  }
  if (from <= 2 && c === 'ש') return 2
  if (from <= 3 && 'בכלמ'.includes(c)) return 3
  // ב/כ/ל absorb the article (בַּ־), so a written ה after them is part of the word (לְהַקְרִיב).
  if (from <= 4 && c === 'ה' && !(from === 4 && 'בכל'.includes(cs[i - 1]!.letter))) return 4
  return -1
}

/** Does the pointing fit the prefix pattern, and is it unambiguous (vowel + dagesh)? */
function prefixPointing(stage: number, c: Cluster, n: Cluster): { ok: boolean; strong: boolean } {
  if (stage === 0) return { ok: true, strong: true }
  if (stage === 2) return { ok: isRelative(c, n), strong: has(n, DAGESH) }
  if (stage === 4) {
    // The article's dagesh is often dropped in a letter with sheva (הַמְבָרֵךְ): ambiguous with hif'il.
    if (has(c, PATACH) && has(n, SHEVA) && !has(n, DAGESH)) return { ok: true, strong: false }
    return { ok: isArticle(c, n), strong: !has(c, HATAF_PATACH) }
  }
  if (c.letter === 'מ') return { ok: isFromPrefix(c, n), strong: has(c, HIRIQ) && has(n, DAGESH) }
  return { ok: isPreposition(c, n), strong: (has(c, PATACH) || has(c, QAMATS)) && has(n, DAGESH) }
}

function prefixFunction(stage: number, c: Cluster): string {
  if (stage === 4 && has(c, HATAF_PATACH)) return 'Interrogative ה (yes/no question)'
  const base = PREFIX_FUNCTION[c.letter]!
  // ב/כ/ל with patach/qamats has absorbed the definite article.
  if (stage === 3 && c.letter !== 'מ' && (has(c, PATACH) || has(c, QAMATS))) return `${base} + "the"`
  return base
}

/** Verb-pattern / participle pattern for a non-prefix initial ה or מ. */
function formativePattern(c: Cluster, n: Cluster): string | null {
  const reduced = has(n, SHEVA) || has(n, HATAF_PATACH) || has(n, HATAF_SEGOL)
  if (c.letter === 'ה') {
    if ((has(c, HIRIQ) || has(c, SEGOL)) && (reduced || n.letter === 'ת')) {
      return n.letter === 'ת' ? "Hitpa'el verb prefix ה" : "Hif'il verb prefix ה"
    }
    if (has(c, PATACH) && has(n, SHEVA) && !has(n, DAGESH)) return "Hif'il verb prefix ה"
  }
  if (c.letter === 'מ' && (has(c, SHEVA) || ((has(c, PATACH) || has(c, HIRIQ)) && reduced))) {
    return 'Participle / noun-forming מ'
  }
  return null
}

interface PrefixDecision {
  peel: boolean
  classification: PrefixClass
  function: string
  reason: string
  confident: boolean
}

/**
 * Classify a word's leading letters as grammatical prefixes or part of the word,
 * peeling stacked prefixes (ו → כ/מ+שֶׁ → שֶׁ → ב/כ/ל/מ → ה). Per letter, in order:
 * manual override → preposition + pronoun / Divine Name → 1-letter remainder (Rule A)
 * → pointing filter → dictionary headword → independent-word test (Rule B)
 * → consonant count of the remainder (Rules A/B), boosted by a soft בכפ after ב/כ.
 */
export function classifyPrefix(word: string, ctx: PrefixContext = {}): PrefixAnalysis {
  const cs = toClusters(word)
  const pointed = POINTING.test(word)
  const isKnown = ctx.isKnownStem ?? (() => false)
  const origHead = ctx.headword?.(word) ?? ''
  const text = (from: number) => cs.slice(from).map((c) => c.text).join('')

  const decide = (i: number, stage: number): PrefixDecision => {
    const c = cs[i]!
    const n = cs[i + 1]!
    const letter = c.letter
    const form = text(i)
    const stem = text(i + 1)
    const fn = prefixFunction(stage, c)
    const peel = (reason: string, confident: boolean, func = fn): PrefixDecision =>
      ({ peel: true, classification: 'prefix', function: func, reason, confident })
    const keep = (classification: PrefixClass, func: string, reason: string, confident: boolean): PrefixDecision =>
      ({ peel: false, classification, function: func, reason, confident })

    const override = ctx.overrides?.[lexiconKey(form)]
    if (override === 'prefix') return peel('Manual override', true)
    if (override) return keep(override, override === 'root' ? 'Part of the word' : 'Grammatical form letter', 'Manual override', true)

    const formKey = consonantalKey(form)
    const stemCons = consonantalKey(stem)
    if (stage === 3 && PRONOUN_FORMS.has(formKey) && !has(c, TSERE)) {
      return peel('Preposition carrying a pronoun suffix (exception to the 3-consonant rule)', true, `${PREFIX_FUNCTION[letter]} + pronoun suffix`)
    }
    if (stage !== 2 && DIVINE_NAMES.has(stemCons)) return peel('Attached to the Divine Name', true)

    const head = ctx.headword?.(form) || origHead
    const h2 = head.length >= 2 ? head.slice(0, 2) : ''
    const spans = !!h2 && formKey.startsWith(h2) && !stemCons.startsWith(h2)

    const notPrefix = (reason: string, confident: boolean): PrefixDecision => {
      const pattern = i === 0 ? formativePattern(c, n) : null
      if (pattern) {
        if (spans) return keep('root', 'Part of the word', `The dictionary headword (${head}) includes ${letter} as a root letter`, true)
        if (h2) return keep('formative', pattern, `${pattern}; the dictionary headword (${head}) is the root without it`, true)
        if (baseConsonants(form) >= 4) return keep('formative', pattern, `${pattern} pattern — part of the word's grammatical form, not a separable prefix`, false)
      }
      return keep('root', 'Part of the word', reason, confident)
    }

    if (cs.length - i - 1 < 2) return notPrefix('Removing it leaves a single letter, so it belongs to the word (Rule A)', true)

    const known = isKnown(stem)
    const cons = baseConsonants(stem)
    const pt = pointed ? prefixPointing(stage, c, n) : { ok: known && cons >= 3, strong: false }
    if (!pt.ok) {
      return notPrefix(pointed
        ? 'Its vowel pointing does not fit the prefix pattern'
        : 'Unpointed, and the remainder is not an independent 3-letter word', pointed || spans)
    }

    if (spans) {
      if (known && cons >= 3) return peel(`The headword (${head}) includes ${letter}, but ${stem} is an independent word (Rule B)`, pointed)
      return notPrefix(`The dictionary headword (${head}) includes ${letter} as a root letter`, true)
    }
    if (known) return peel(`Removing it leaves the independent word ${stem} (Rule B / context test)`, pointed)
    if (h2 && stemCons.startsWith(h2)) return peel(`The dictionary headword (${head}) starts after the prefix`, pointed)
    const soft = stage === 3 && 'בכ'.includes(letter) && 'בכפ'.includes(n.letter) && !has(n, DAGESH)
    if (cons >= 3) {
      return peel(`Pointing fits and ${cons} consonants remain (Rule B)${soft ? '; a soft ב/כ/פ follows' : ''}`, pt.strong || soft)
    }
    if (pt.strong) return peel('Unambiguous prefix pointing (vowel + dagesh)', false)
    return notPrefix(`Only ${cons} consonants would remain (Rule A)`, false)
  }

  const steps: PrefixStep[] = []
  let stop: PrefixDecision | null = null
  let stage = 0
  let i = 0
  for (; i < cs.length - 1; i++) {
    const found = prefixStage(cs, i, stage, pointed)
    if (found < 0) break
    const d = decide(i, found)
    if (!d.peel) {
      stop = d
      break
    }
    steps.push({ letter: cs[i]!.letter, function: d.function, reason: d.reason, confident: d.confident })
    stage = found + 1
  }

  const stem = text(i)
  const base = steps.length && cs.length - i < 2 ? text(i - 1) : stem
  if (!steps.length && !stop) {
    return { word, classification: null, steps, stem, base, function: '', reason: 'Does not start with a prefix letter', confident: true }
  }
  return {
    word,
    classification: steps.length ? 'prefix' : stop!.classification,
    steps,
    stem,
    base,
    function: steps.length ? steps.map((s) => s.function).join(' + ') : stop!.function,
    reason: steps.length ? steps.map((s) => `${s.letter}: ${s.reason}`).join('; ') : stop!.reason,
    confident: steps.every((s) => s.confident) && (stop?.confident ?? true),
  }
}
