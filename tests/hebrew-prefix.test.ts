import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PrefixContext } from '../shared/utils/hebrew'
import { classifyPrefix, consonantalKey, knownStemChecker, lexiconKey } from '../shared/utils/hebrew'

/** Context with a corpus of known standalone forms and a { form: headword } dictionary. */
function ctx(known: string[] = [], heads: Record<string, string> = {}, overrides: PrefixContext['overrides'] = {}): PrefixContext {
  const headByKey = new Map(Object.entries(heads).map(([f, h]) => [lexiconKey(f), consonantalKey(h)]))
  return {
    isKnownStem: knownStemChecker(known),
    headword: (form) => headByKey.get(lexiconKey(form)) ?? '',
    overrides,
  }
}

const letters = (word: string, c: PrefixContext = ctx()) => classifyPrefix(word, c).steps.map((s) => s.letter)

test('ל before an independent word is a prefix, even when the headword includes it', () => {
  const r = classifyPrefix('לְעוֹלָם', ctx(['עוֹלָם'], { 'לְעוֹלָם': 'לעולם' }))
  assert.equal(r.classification, 'prefix')
  assert.equal(r.base, 'עוֹלָם')
})

test('ב that the headword shows is a root letter stays', () => {
  assert.equal(classifyPrefix('בָּרוּךְ', ctx([], { 'בָּרוּךְ': 'ברך' })).classification, 'root')
  assert.equal(classifyPrefix('בְּרִית', ctx([], { 'בְּרִית': 'ברית' })).classification, 'root')
})

test('a 2-letter remainder does not make a prefix (Rule A)', () => {
  assert.equal(classifyPrefix('בַּֽעַל', ctx(['עַל'], { 'בַּֽעַל': 'בעל' })).classification, 'root')
  assert.equal(classifyPrefix('שֶׁל').classification, 'root')
  assert.equal(classifyPrefix('כִּי').classification, 'root')
  assert.equal(classifyPrefix('מִי').classification, 'root')
})

test('preposition + pronoun suffix is a prefix but keeps the whole form as its base', () => {
  const r = classifyPrefix('לְךָ')
  assert.equal(r.classification, 'prefix')
  assert.equal(r.base, 'לְךָ')
  assert.equal(classifyPrefix('וְלוֹ').base, 'לוֹ')
})

test('relative שֶׁ is a prefix; שׁ root words with incompatible pointing stay', () => {
  assert.deepEqual(letters('שֶׁהֵם', ctx(['הֵם'])), ['ש'])
  assert.equal(classifyPrefix('שֶֽׁקֶר').classification, 'root')
})

test('stacked prefixes peel in order', () => {
  assert.deepEqual(letters('וּבְיוֹמֵיכוֹן'), ['ו', 'ב'])
  assert.deepEqual(letters('כְּשֶׁעָמְדָה'), ['כ', 'ש'])
})

test('ה after ב/כ/ל is not the article (it is absorbed there)', () => {
  assert.deepEqual(letters('לְהַקְרִיב', ctx([], { 'לְהַקְרִיב': 'קרב' })), ['ל'])
  assert.deepEqual(letters('וְהַמֶּלֶךְ'), ['ו', 'ה'])
})

test('definite article and Divine Name', () => {
  assert.deepEqual(letters('הַכֹּל', ctx([], { 'הַכֹּל': 'כל' })), ['ה'])
  assert.deepEqual(letters('לַייָ'), ['ל'])
})

test('pointing that does not fit a prefix keeps the letter in the word', () => {
  assert.equal(classifyPrefix('מֶֽלֶךְ').classification, 'root')
})

test('verb-pattern ה is formative, not a prefix', () => {
  assert.equal(classifyPrefix('הִתְהַלְּלוּ').classification, 'formative')
  assert.equal(classifyPrefix('מְקַדֵּשׁ', ctx([], { 'מְקַדֵּשׁ': 'קדש' })).classification, 'formative')
})

test('unpointed words rely on the corpus and are never confident', () => {
  const r = classifyPrefix('בבית', ctx(['בַּיִת']))
  assert.equal(r.classification, 'prefix')
  assert.equal(r.confident, false)
})

test('overrides win', () => {
  const c = ctx([], {}, { [lexiconKey('לְמַעַן')]: 'root' })
  assert.equal(classifyPrefix('לְמַעַן', c).classification, 'root')
})

test('words not starting with a prefix letter are not applicable', () => {
  assert.equal(classifyPrefix('אֱמֶת').classification, null)
})
