/**
 * Markdown export of the prefix analysis (the same data as the /prefixes page).
 *
 *   SIDDUR_URL=http://localhost:3001 npm run prefixes:report   (default :3000)
 *
 * Writes reports/prefix-report.md with low-confidence words first, each with links
 * to where it occurs and a context snippet. Change classifications on the /prefixes
 * page (dev server), which saves them to server/assets/prefix.overrides.json.
 */
import type { PrefixReport, PrefixReportRow } from '../shared/types/siddur'
import { sectionElementId, sectionPath } from '../app/utils/toc'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SIDDUR_URL = process.env.SIDDUR_URL ?? 'http://localhost:3000'
const OUT_FILE = resolve('reports/prefix-report.md')

console.log(`Fetching prefix analysis from ${SIDDUR_URL}/api/prefixes …`)
const report = await fetch(`${SIDDUR_URL}/api/prefixes`)
  .then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json() as Promise<PrefixReport>
  })
  .catch((e) => {
    console.error(`Could not load ${SIDDUR_URL}/api/prefixes (${e instanceof Error ? e.message : e}).`)
    console.error('Start `npm run dev`, or set SIDDUR_URL (e.g. SIDDUR_URL=http://localhost:3001).')
    process.exit(1)
  })

const LABEL = { prefix: 'PREFIX', root: 'ROOT WORD', formative: 'FORMATIVE (verb-pattern letter)' } as const

function entry(r: PrefixReportRow, n: number): string {
  const cls = r.override ?? r.auto
  const classification = r.override ? `${LABEL[cls]} (override; rules say ${LABEL[r.auto]})` : LABEL[cls]
  const head = r.headword ? ` — headword ${r.headword}` : ''
  const fn = r.auto !== 'prefix' && r.meaning ? `${r.function} — "${r.meaning}"` : r.function
  const where = r.locations.length
    ? r.locations.map((l) =>
        `   - [${l.title}](${SIDDUR_URL}${sectionPath(l.topKey)}#${sectionElementId(l.ref)}), ¶${l.paragraph}: ${l.before} **${l.word}** ${l.after}`)
    : ['   - (not found)']
  if (r.locations.length && r.count > r.locations.length) where.push(`   - … and ${r.count - r.locations.length} more`)
  return [
    `### ${n}. ${r.word}  <sub>×${r.count}${r.confident ? '' : ' · needs review'}</sub>`,
    '',
    `1. **Analyzed Word:** ${r.word}`,
    `2. **Classification:** ${classification}`,
    `3. **Identified Core Word/Root:** ${r.base}${head}`,
    `4. **Grammatical Function:** ${fn}`,
    `5. **Justification:** ${r.reason}`,
    `6. **Location:**`,
    ...where,
    '',
  ].join('\n')
}

const { rows } = report
const review = rows.filter((r) => !r.confident)
const sure = rows.filter((r) => r.confident)
const tally = (cls: string) => rows.filter((r) => (r.override ?? r.auto) === cls).length
const md = [
  '# Prefix analysis',
  '',
  `${rows.length} forms starting with ב/כ/ל/מ/ה/ו/ש — ${tally('prefix')} prefix, ${tally('root')} root, ${tally('formative')} formative; ${rows.filter((r) => r.override).length} overridden.`,
  'Change a classification on the /prefixes page of the dev server.',
  '',
  `## Needs review (${review.length})`,
  '',
  ...review.map((r, i) => entry(r, i + 1)),
  `## Confident (${sure.length})`,
  '',
  ...sure.map((r, i) => entry(r, review.length + i + 1)),
].join('\n')

mkdirSync(resolve('reports'), { recursive: true })
writeFileSync(OUT_FILE, md)
console.log(`${rows.length} forms: ${review.length} need review → ${OUT_FILE}`)
