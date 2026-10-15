<script setup lang="ts">
import type { PrefixReport, PrefixReportRow } from '~~/shared/types/siddur'
import type { PrefixClass } from '~~/shared/utils/hebrew'

const { data, pending, error } = useFetch<PrefixReport>('/api/prefixes', { server: false })
const toast = useToast()

const CLASSES: PrefixClass[] = ['prefix', 'root', 'formative']
const LABEL: Record<PrefixClass, string> = { prefix: 'Prefix', root: 'Root', formative: 'Formative' }
const COLOR: Record<PrefixClass, 'info' | 'success' | 'secondary'> = { prefix: 'info', root: 'success', formative: 'secondary' }

const effective = (r: PrefixReportRow) => r.override ?? r.auto
// Low-confidence rows the user hasn't decided yet.
const unresolved = (r: PrefixReportRow) => !r.confident && !r.override

// --- Model votes ---
// Binary vote glyphs: ✓ prefix, ¬ non-prefix, — no vote.
const VOTE: Record<string, string> = { prefix: '✓P', 'non-prefix': '¬P' }
const vote = (v?: string) => (v ? (VOTE[v] ?? v) : '—')
// Rows from the exact 1,192-key bulk-prefix tranche reverted for human review.
const revertedTranche = (r: PrefixReportRow) => r.reverted
const binaryAuto = (r: PrefixReportRow) => (r.auto === 'prefix' ? 'prefix' : 'non-prefix')
const jointDisagrees = (r: PrefixReportRow) => Boolean(r.models?.joint && r.models.joint !== binaryAuto(r))

const spotCheck = ref(false)
type ReviewStage = 'all' | 'high-disagreement' | 'high-remaining' | 'low-disagreement' | 'low-remaining'
const reviewStage = ref<ReviewStage>('all')
const reviewStageItems = [
  { label: 'All review steps', value: 'all' },
  { label: '1. High-confidence disagreements', value: 'high-disagreement' },
  { label: '2. Remaining high-confidence', value: 'high-remaining' },
  { label: '3. Low-confidence disagreements', value: 'low-disagreement' },
  { label: '4. Remaining low-confidence', value: 'low-remaining' },
]
const reviewStageOf = (r: PrefixReportRow): Exclude<ReviewStage, 'all'> => {
  if (r.confident) return jointDisagrees(r) ? 'high-disagreement' : 'high-remaining'
  return jointDisagrees(r) ? 'low-disagreement' : 'low-remaining'
}
// Unjudged first, then high-confidence/model-disagreement rows and frequency; judged rows remain visible for audit.
const revertedRows = computed(() =>
  rows.value
    .filter(revertedTranche)
    .sort((a, b) =>
      Number(Boolean(a.override)) - Number(Boolean(b.override))
      || Number(b.confident) - Number(a.confident)
      || Number(jointDisagrees(b)) - Number(jointDisagrees(a))
      || b.count - a.count,
    ),
)
const spotRows = computed(() =>
  reviewStage.value === 'all'
    ? revertedRows.value
    : revertedRows.value.filter((r) => reviewStageOf(r) === reviewStage.value),
)
const spotTally = computed(() => {
  let judged = 0
  let peeled = 0
  for (const r of revertedRows.value) {
    if (r.override) {
      judged++
      if (r.override === 'prefix') peeled++
    }
  }
  return { judged, peeled, kept: judged - peeled, pending: revertedRows.value.length - judged }
})
const confirmed = (r: PrefixReportRow) => r.override === r.auto
// Unresolved rows show a placeholder instead of preselecting the rules' guess.
const selectValue = (r: PrefixReportRow) => (unresolved(r) ? '' : effective(r))

const reviewStages = computed(() => {
  const pending = revertedRows.value.filter((r) => !r.override)
  return [
    {
      title: 'Review high-confidence model disagreements',
      detail: 'Resolve strong rules calls where DictaBERT-joint disagrees.',
      count: pending.filter((r) => r.confident && jointDisagrees(r)).length,
    },
    {
      title: 'Review remaining high-confidence forms',
      detail: 'Confirm or correct the other strong rules calls.',
      count: pending.filter((r) => r.confident && !jointDisagrees(r)).length,
    },
    {
      title: 'Review low-confidence model disagreements',
      detail: 'Use pointing, context, and lookup policy where the evidence conflicts.',
      count: pending.filter((r) => !r.confident && jointDisagrees(r)).length,
    },
    {
      title: 'Review remaining low-confidence forms',
      detail: 'Resolve the final ambiguous forms manually.',
      count: pending.filter((r) => !r.confident && !jointDisagrees(r)).length,
    },
  ]
})

// --- Filters ---
type ClassFilter = 'all' | PrefixClass
const search = ref('')
const classFilter = ref<ClassFilter>('all')
const reviewOnly = ref(false)
const overriddenOnly = ref(false)
const classFilterItems = [
  { label: 'All classes', value: 'all' },
  ...CLASSES.map((c) => ({ label: LABEL[c], value: c })),
]

const rows = computed(() => data.value?.rows ?? [])
// Search ignores vowels/cantillation so unpointed input matches.
const searchKeys = computed(() => new Map(rows.value.map((r) => [r.word, `${normalizeHebrewWord(r.word)} ${normalizeHebrewWord(r.base)}`])))
const filtered = computed(() => {
  const q = normalizeHebrewWord(search.value)
  return rows.value.filter((r) =>
    (!q || searchKeys.value.get(r.word)!.includes(q))
    && (classFilter.value === 'all' || effective(r) === classFilter.value)
    && (!reviewOnly.value || unresolved(r))
    && (!overriddenOnly.value || r.override),
  )
})
// In spot-check mode the list is exactly the reverted bulk tranche.
const shown = computed(() => (spotCheck.value ? spotRows.value : filtered.value))

const tally = computed(() => {
  const t = { prefix: 0, root: 0, formative: 0, review: 0, overridden: 0, confirmed: 0 }
  for (const r of rows.value) {
    t[effective(r)]++
    if (unresolved(r)) t.review++
    if (confirmed(r)) t.confirmed++
    else if (r.override) t.overridden++
  }
  return t
})

// --- Pagination ---
const PAGE_SIZE = 50
const page = ref(1)
watch([search, classFilter, reviewOnly, overriddenOnly, spotCheck, reviewStage], () => (page.value = 1))
const pageRows = computed(() => shown.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))
watch(page, () => window.scrollTo({ top: 0 }))

// --- Overrides ---
const saving = ref(new Set<string>())
async function setClass(row: PrefixReportRow, value: PrefixClass | null, persist = false) {
  // On confident rows, choosing what the rules already say just clears the override;
  // on low-confidence rows it's saved as a confirmation. `persist` (spot-check)
  // always stores the judgement so it counts as a decided sample.
  const next = !persist && value === row.auto && row.confident ? null : value
  if (next === row.override) return
  const prev = row.override
  row.override = next
  saving.value = new Set(saving.value).add(row.word)
  try {
    await $fetch('/api/prefixes/overrides', { method: 'PUT', body: { word: row.word, classification: next } })
  } catch (e) {
    row.override = prev
    toast.add({
      title: `Could not save ${row.word}`,
      description: (e as { statusMessage?: string }).statusMessage ?? String(e),
      color: 'error',
    })
  } finally {
    const s = new Set(saving.value)
    s.delete(row.word)
    saving.value = s
  }
}

function onSelect(row: PrefixReportRow, event: Event) {
  setClass(row, (event.target as HTMLSelectElement).value as PrefixClass)
}

const locationPath = (topKey: string, ref: string) => `${sectionPath(topKey)}#${sectionElementId(ref)}`
</script>

<template>
  <div class="min-h-screen bg-neutral-50">
    <header class="flex items-center justify-between gap-2 border-b border-neutral-200 bg-white px-4 py-3">
      <UButton to="/words" icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="sm">Words</UButton>
      <h1 class="text-base font-semibold">Prefix Analysis</h1>
      <span />
    </header>

    <ClientOnly>
      <main class="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
        <p v-if="pending" class="text-center italic text-neutral-500">
          Analyzing the full siddur… (first load can take a while)
        </p>
        <p v-else-if="error" class="text-center text-red-700">Failed to load prefix analysis.</p>

        <template v-else-if="data">
          <div class="flex flex-wrap gap-2 text-sm">
            <UBadge color="neutral" variant="subtle">{{ rows.length }} forms</UBadge>
            <UBadge v-for="c in CLASSES" :key="c" :color="COLOR[c]" variant="subtle">{{ LABEL[c] }} {{ tally[c] }}</UBadge>
            <UBadge color="warning" variant="subtle">Needs review {{ tally.review }}</UBadge>
            <UBadge color="primary" variant="subtle">Overridden {{ tally.overridden }}</UBadge>
            <UBadge color="success" variant="subtle">Confirmed {{ tally.confirmed }}</UBadge>
            <template v-if="spotCheck">
              <UBadge color="secondary" variant="subtle">Reverted review {{ spotTally.pending }} pending</UBadge>
              <UBadge v-if="spotTally.judged" color="info" variant="subtle">
                Reviewed {{ spotTally.judged }} · peeled {{ spotTally.peeled }} · kept whole {{ spotTally.kept }}
              </UBadge>
            </template>
          </div>

          <p v-if="!data.editable" class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Read-only: overrides can only be saved on the dev server (<code>npm run dev</code>).
          </p>

          <div class="flex flex-wrap items-center gap-3">
            <UInput v-model="search" icon="i-lucide-search" placeholder="Search (vowels optional)" dir="rtl" class="w-56" :disabled="spotCheck" />
            <USelect v-model="classFilter" :items="classFilterItems" class="w-40" :disabled="spotCheck" />
            <USwitch v-model="reviewOnly" label="Needs review" :disabled="spotCheck" />
            <USwitch v-model="overriddenOnly" label="Overridden / confirmed" :disabled="spotCheck" />
            <USwitch v-model="spotCheck" label="Review reverted tranche" />
            <USelect v-if="spotCheck" v-model="reviewStage" :items="reviewStageItems" class="w-64" />
          </div>

          <div v-if="spotCheck" class="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
            <h2 class="font-semibold text-neutral-900">Next manual steps</h2>
            <p class="mt-1 text-neutral-600">Work in this order. For lexicalized or idiomatic forms, keep the whole form for lookup.</p>
            <ol class="mt-3 flex flex-col gap-3">
              <li v-for="(stage, index) in reviewStages" :key="stage.title" class="flex items-start gap-3">
                <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 font-semibold text-neutral-700">{{ index + 1 }}</span>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <span class="font-medium text-neutral-900">{{ stage.title }}</span>
                    <UBadge :color="stage.count ? 'warning' : 'success'" variant="subtle">{{ stage.count }} pending</UBadge>
                  </div>
                  <p class="text-neutral-500">{{ stage.detail }}</p>
                </div>
              </li>
            </ol>
          </div>

          <p v-if="!shown.length" class="rounded-lg border border-neutral-200 bg-white p-8 text-center italic text-neutral-500">
            No matching forms.
          </p>

          <article
            v-for="r in pageRows"
            :key="r.word"
            class="rounded-lg border bg-white p-4"
            :class="unresolved(r) ? 'border-amber-300' : 'border-neutral-200'"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="flex flex-wrap items-center gap-2">
                <select
                  class="class-select"
                  :class="unresolved(r) ? 'class-review' : `class-${effective(r)}`"
                  :value="selectValue(r)"
                  :disabled="!data.editable || saving.has(r.word)"
                  :aria-label="`Classification of ${r.word}`"
                  @change="onSelect(r, $event)"
                >
                  <option v-if="unresolved(r)" value="" disabled>Review — rules say {{ LABEL[r.auto] }}</option>
                  <option v-for="c in CLASSES" :key="c" :value="c">
                    {{ LABEL[c] }}{{ c === r.auto ? ' (rules)' : '' }}
                  </option>
                </select>
                <template v-if="r.override">
                  <UBadge v-if="confirmed(r)" color="success" variant="subtle" size="sm">Confirmed</UBadge>
                  <UBadge v-else color="primary" variant="subtle" size="sm">Overridden · rules say {{ LABEL[r.auto] }}</UBadge>
                  <UButton
                    v-if="data.editable"
                    icon="i-lucide-undo-2"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :disabled="saving.has(r.word)"
                    @click="setClass(r, null)"
                  >
                    {{ confirmed(r) ? 'Undo' : 'Reset' }}
                  </UButton>
                </template>
                <UBadge v-else-if="!r.confident" color="warning" variant="subtle" size="sm">Needs review</UBadge>
                <UIcon v-if="saving.has(r.word)" name="i-lucide-loader-circle" class="size-4 animate-spin text-neutral-400" />
              </div>
              <div dir="rtl" class="flex items-baseline gap-2">
                <span class="he-word">{{ r.word }}</span>
                <span class="text-xs tabular-nums text-neutral-500">×{{ r.count }}</span>
                <span v-if="r.models" dir="ltr" class="votes text-xs" title="Model votes: DictaBERT-joint · DictaLM">
                  J·<b :class="`v-${r.models.joint}`">{{ vote(r.models.joint) }}</b>
                  D·<b :class="`v-${r.models.dictalm}`">{{ vote(r.models.dictalm) }}</b>
                </span>
              </div>
            </div>

            <div v-if="spotCheck" class="mt-3 flex flex-col gap-2 text-sm">
              <p class="text-neutral-700">
                Rules: <b>{{ LABEL[r.auto] }}</b> · {{ r.reason }}
                <span class="text-neutral-500"> · base <bdi dir="rtl" class="he-inline">{{ r.base }}</bdi></span>
              </p>
              <p class="text-neutral-500">
                Model evidence: joint {{ vote(r.models?.joint) }} · DictaLM {{ vote(r.models?.dictalm) }}
              </p>
              <p v-if="r.locations[0]" dir="rtl" class="snippet">
                {{ r.locations[0].before }} <mark>{{ r.locations[0].word }}</mark> {{ r.locations[0].after }}
              </p>
              <div class="flex flex-wrap gap-2">
                <UButton size="sm" color="info" variant="soft" :disabled="!data.editable || saving.has(r.word)" @click="setClass(r, 'prefix', true)">
                  Prefix — peel
                </UButton>
                <UButton size="sm" color="success" variant="soft" :disabled="!data.editable || saving.has(r.word)" @click="setClass(r, 'root', true)">
                  Root — keep whole
                </UButton>
                <UButton size="sm" color="secondary" variant="soft" :disabled="!data.editable || saving.has(r.word)" @click="setClass(r, 'formative', true)">
                  Formative — keep whole
                </UButton>
              </div>
            </div>
            <dl v-if="!spotCheck" class="details mt-3 text-sm">
              <dt>Core word / root</dt>
              <dd>
                <bdi class="he-inline">{{ r.base }}</bdi>
                <span v-if="r.headword" class="text-neutral-500"> — headword <bdi class="he-inline">{{ r.headword }}</bdi></span>
              </dd>
              <dt>Function</dt>
              <dd>
                {{ r.function }}<span v-if="r.auto !== 'prefix' && r.meaning" class="text-neutral-500"> — “{{ r.meaning }}”</span>
              </dd>
              <dt>Justification</dt>
              <dd class="text-neutral-700">{{ r.reason }}</dd>
              <dt>Location</dt>
              <dd>
                <ul class="flex flex-col gap-1.5">
                  <li v-for="(loc, li) in r.locations" :key="li">
                    <NuxtLink :to="locationPath(loc.topKey, loc.ref)" target="_blank" class="text-blue-700 hover:underline">
                      {{ loc.title }}</NuxtLink><span class="text-neutral-400">, ¶{{ loc.paragraph }}</span>
                    <p dir="rtl" class="snippet">
                      {{ loc.before }} <mark>{{ loc.word }}</mark> {{ loc.after }}
                    </p>
                  </li>
                  <li v-if="r.count > r.locations.length" class="text-xs text-neutral-500">
                    … and {{ r.count - r.locations.length }} more
                  </li>
                </ul>
              </dd>
            </dl>
          </article>

          <div v-if="shown.length > PAGE_SIZE" class="flex justify-center">
            <UPagination v-model:page="page" :total="shown.length" :items-per-page="PAGE_SIZE" />
          </div>
        </template>
      </main>
    </ClientOnly>
  </div>
</template>

<style scoped>
.he-word {
  font-family: var(--hebrew-font, inherit);
  font-size: 1.6rem;
  line-height: 1.2;
}
.he-inline,
.snippet {
  font-family: var(--hebrew-font, inherit);
  font-size: 1.05rem;
}
.snippet {
  color: #555;
}
.snippet mark {
  background: #fef3c7;
  color: #111;
  font-weight: 600;
  border-radius: 2px;
  padding: 0 2px;
}
.details {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.35rem 1rem;
}
.details dt {
  color: #737373;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  padding-top: 0.15rem;
}
.class-select {
  border: 1px solid #d4d4d4;
  border-radius: 0.375rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.875rem;
  font-weight: 600;
  background: white;
  cursor: pointer;
}
.class-select:disabled {
  cursor: default;
  opacity: 0.7;
}
.class-prefix {
  border-color: #93c5fd;
  background: #eff6ff;
}
.class-root {
  border-color: #86efac;
  background: #f0fdf4;
}
.class-formative {
  border-color: #c4b5fd;
  background: #f5f3ff;
}
.class-review {
  border-color: #fcd34d;
  background: #fffbeb;
  font-weight: 400;
  color: #92400e;
}
.votes {
  color: #a3a3a3;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.votes b {
  font-weight: 600;
}
.v-prefix {
  color: #2563eb;
}
.v-non-prefix {
  color: #737373;
}
</style>
