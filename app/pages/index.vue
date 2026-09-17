<script setup lang="ts">
import type { TocNode } from '~~/shared/types/siddur'
import type { NavigationMenuItem } from '@nuxt/ui'

const { data: toc, pending: tocPending, error: tocError } = await useSiddurToc()
const { sections, loading, errors, loadSection } = useSiddurSections()
const { drafts, getDraft, setDraft, clearDraft, hasDraft } = useTranslationDrafts()

const activeRef = ref<string | null>(null)
// Global toggles in the fixed action bar: 👁 reveals every translation,
// ✎ reveals every word input.
const showEnglish = ref(false)
const showInputs = ref(false)
const sidebarOpen = ref(false)
const contentEl = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

function wordId(ref: string, paraIndex: number, segIndex: number, wordIndex: number) {
  return `${ref}::${paraIndex}::${segIndex}::${wordIndex}`
}

// --- Translation editor state ---
const editingPara = ref<string | null>(null) // `${ref}::${paraIndex}`
const reviewing = ref(false)

function paraKey(ref: string, paraIndex: number) {
  return `${ref}::${paraIndex}`
}

function startEdit(ref: string, paraIndex: number) {
  const key = paraKey(ref, paraIndex)
  if (editingPara.value === key) return
  editingPara.value = key
  reviewing.value = false
}

function cancelEdit() {
  editingPara.value = null
  reviewing.value = false
}

function saveDraft(ref: string, paraIndex: number, value: string) {
  setDraft(ref, paraIndex, value)
}

function discardDraft(ref: string, paraIndex: number) {
  clearDraft(ref, paraIndex)
  cancelEdit()
}

const draftCount = computed(() =>
  Object.values(drafts.value).filter((v) => v?.trim()).length,
)

function csvEscape(value: string): string {
  if (/["\n,]/.test(value)) return '"' + value.replace(/"/g, '""') + '"'
  return value
}

function exportDrafts() {
  const entries = Object.entries(drafts.value)
    .filter(([, text]) => text?.trim())
    .map(([key, text]) => {
      const sep = key.lastIndexOf('::')
      const ref = key.slice(0, sep)
      const paraIndex = Number(key.slice(sep + 2))
      return { segmentRef: `${ref} ${paraIndex + 1}`, text }
    })
    .sort((a, b) => a.segmentRef.localeCompare(b.segmentRef, undefined, { numeric: true }))

  if (!entries.length) return

  const csv = [
    'Ref,text',
    ...entries.map((e) => `${csvEscape(e.segmentRef)},${csvEscape(e.text)}`),
  ].join('\n')

  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'siddur-translations.csv'
  a.click()
  URL.revokeObjectURL(url)
}

/** Flatten the TOC tree into an ordered list of leaf (ref, title) entries. */
function flattenLeaves(nodes: TocNode[]): TocNode[] {
  const out: TocNode[] = []
  for (const node of nodes) {
    if (node.children) out.push(...flattenLeaves(node.children))
    else out.push(node)
  }
  return out
}

const leaves = computed(() => (toc.value ? flattenLeaves(toc.value.sections) : []))

/** Load every section's text with a small concurrency cap so we don't hammer the API at once. */
async function loadAllSections(refs: string[], concurrency = 5) {
  let cursor = 0
  async function worker() {
    while (cursor < refs.length) {
      const ref = refs[cursor++]
      await loadSection(ref)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
}

// Section text is fetched on-demand rather than via useFetch/useAsyncData, so its
// timing relative to SSR render is non-deterministic. Only trigger it client-side to
// avoid hydration mismatches between the SSR HTML and the client's initial render.
if (import.meta.client) {
  watch(
    leaves,
    (list) => {
      if (list.length) loadAllSections(list.map((l) => l.ref!))
    },
    { immediate: true },
  )
}

function sectionElementId(ref: string) {
  return `section-${ref.replace(/[^a-zA-Z0-9]+/g, '-')}`
}

function handleSelect(ref: string) {
  activeRef.value = ref
  loadSection(ref)
  sidebarOpen.value = false
  nextTick(() => {
    document.getElementById(sectionElementId(ref))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

function buildNavItems(nodes: TocNode[]): NavigationMenuItem[] {
  return nodes.map((node) => {
    if (node.children) {
      return {
        label: node.title,
        defaultOpen: true,
        children: buildNavItems(node.children),
      }
    }
    return {
      label: node.title,
      active: activeRef.value === node.ref,
      onSelect: (e: Event) => {
        e.preventDefault()
        if (node.ref) handleSelect(node.ref)
      },
    }
  })
}

const navItems = computed(() => {
  if (!toc.value) return []
  return buildNavItems(toc.value.sections)
})

/** Observe section elements and set activeRef to the topmost visible section. */
function setupObserver() {
  if (observer) observer.disconnect()
  observer = new IntersectionObserver(
    (entries) => {
      // Find the entry closest to the top of the viewport that is intersecting.
      let best: { ref: string; top: number } | null = null
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const ref = (entry.target as HTMLElement).dataset.ref
        if (!ref) continue
        const top = entry.boundingClientRect.top
        if (!best || Math.abs(top) < Math.abs(best.top)) {
          best = { ref, top }
        }
      }
      if (best) activeRef.value = best.ref
    },
    { rootMargin: '-16px 0px -70% 0px', threshold: 0 },
  )
  for (const leaf of leaves.value) {
    const el = document.getElementById(sectionElementId(leaf.ref!))
    if (el) observer.observe(el)
  }
}

onMounted(() => {
  if (import.meta.client) setupObserver()
})

// Sections render asynchronously, so re-observe whenever the leaf list changes.
if (import.meta.client) {
  watch(leaves, () => nextTick(() => setupObserver()))
}

onBeforeUnmount(() => {
  observer?.disconnect()
})
</script>

<template>
  <div class="layout">
    <UDashboardGroup>
      <UDashboardSidebar v-model:open="sidebarOpen" collapsible :collapsed-size="0" :ui="{ root: 'min-w-0 z-50' }">
        <template #default>
          <h1 class="app-title">Weekday Siddur Chabad</h1>
          <p v-if="tocPending">Loading table of contents…</p>
          <p v-else-if="tocError">Failed to load table of contents.</p>
          <UNavigationMenu
            v-else-if="toc"
            :items="navItems"
            orientation="vertical"
          />
        </template>
      </UDashboardSidebar>

      <UDashboardPanel id="siddur">
        <template #header>
          <UDashboardNavbar>
            <template #left>
              <UDashboardSidebarCollapse class="hidden lg:flex" />
            </template>
            <template #right>
              <UButton
                :icon="showEnglish ? 'i-lucide-eye' : 'i-lucide-eye-off'"
                :color="showEnglish ? 'primary' : 'neutral'"
                variant="outline"
                size="sm"
                :aria-pressed="showEnglish"
                :aria-label="showEnglish ? 'Hide all translations' : 'Show all translations'"
                :title="showEnglish ? 'Hide all translations' : 'Show all translations'"
                @click="showEnglish = !showEnglish"
              />
              <UButton
                :icon="showInputs ? 'i-lucide-pencil' : 'i-lucide-pencil-off'"
                :color="showInputs ? 'primary' : 'neutral'"
                variant="outline"
                size="sm"
                :aria-pressed="showInputs"
                :aria-label="showInputs ? 'Hide all input fields' : 'Show all input fields'"
                :title="showInputs ? 'Hide all input fields' : 'Show all input fields'"
                @click="showInputs = !showInputs"
              />
              <UButton
                icon="i-lucide-download"
                color="neutral"
                variant="outline"
                size="sm"
                :disabled="draftCount === 0"
                :title="`Export ${draftCount} draft${draftCount === 1 ? '' : 's'} as CSV for submission to Sefaria`"
                @click="exportDrafts"
              >
                Export{{ draftCount > 0 ? ` (${draftCount})` : '' }}
              </UButton>
            </template>
          </UDashboardNavbar>
        </template>

        <template #body>
          <section
            v-for="leaf in leaves"
            :id="sectionElementId(leaf.ref!)"
            :data-ref="leaf.ref"
            :key="leaf.ref"
            class="prayer-section"
          >
        <h2>
          {{ leaf.title }}
          <span class="he-title">{{ leaf.heTitle }}</span>
        </h2>

        <p v-if="loading[leaf.ref!]" class="status">Loading…</p>
        <p v-else-if="errors[leaf.ref!]" class="status error">{{ errors[leaf.ref!] }}</p>

        <template v-else-if="sections[leaf.ref!]">
          <p v-if="!sections[leaf.ref!].hasTranslation" class="no-translation-note">
            No English translation is available yet for this section on Sefaria.
          </p>
          <div
            v-for="(para, i) in sections[leaf.ref!].paragraphs"
            :key="i"
            class="paragraph"
          >
            <span v-if="para.en && showEnglish" class="english" v-html="para.en" />

            <!-- Translation editor -->
            <div v-if="showEnglish" class="translation-editor">
              <button
                v-if="editingPara !== paraKey(leaf.ref!, i)"
                type="button"
                class="edit-translation-btn"
                @click="startEdit(leaf.ref!, i)"
              >
                {{ hasDraft(leaf.ref!, i) ? '✎ Edit Draft' : '✎ Add Translation' }}
              </button>

              <div v-if="editingPara === paraKey(leaf.ref!, i)" class="translation-form">
                <textarea
                  :value="getDraft(leaf.ref!, i) || para.en || ''"
                  class="translation-textarea"
                  placeholder="Enter English translation…"
                  rows="4"
                  @input="saveDraft(leaf.ref!, i, ($event.target as HTMLTextAreaElement).value)"
                />
                <div class="translation-actions">
                  <button type="button" class="t-btn t-cancel" @click="cancelEdit">Cancel</button>
                  <button type="button" class="t-btn t-discard" @click="discardDraft(leaf.ref!, i)">Discard Draft</button>
                  <button type="button" class="t-btn t-review" @click="reviewing = !reviewing">
                    {{ reviewing ? 'Hide Review' : 'Review' }}
                  </button>
                </div>
                <div v-if="reviewing" class="translation-review">
                  <p class="review-label">Current:</p>
                  <p class="review-current">{{ para.en || '(no existing translation)' }}</p>
                  <p class="review-label">Draft:</p>
                  <p class="review-draft">{{ getDraft(leaf.ref!, i) }}</p>
                </div>
              </div>
            </div>

            <div class="line-wrap">
              <div class="hebrew-line">
                <template v-for="(seg, si) in para.segments" :key="si">
                  <span v-if="seg.type === 'note'" class="note-text" dir="rtl" v-html="seg.html" />
                  <template v-else>
                    <HebrewWord
                      v-for="(word, wi) in seg.words"
                      :key="wi"
                      :id="wordId(leaf.ref!, i, si, wi)"
                      :word="word"
                      :show-input="showInputs"
                      :sentence-start="wi === 0"
                    />
                  </template>
                </template>
              </div>
            </div>
          </div>
        </template>

        <p v-else class="status">Not loaded yet…</p>
      </section>
        </template>
      </UDashboardPanel>
    </UDashboardGroup>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  min-height: 100vh;
}
:deep([data-collapsed="true"] [data-slot="body"]) {
  display: none;
}
.app-title {
  font-size: 1.1rem;
  margin: 0 0 1rem;
}
.content {
  flex: 1;
  min-width: 0;
  padding: 1.5rem 2rem;
  /* Fixed column count per breakpoint; consumed by .word-cell in HebrewWord.vue
     to size every cell identically. Default covers ≤1023px. */
  --cols: 5;
}
@media (min-width: 1024px) {
  .content {
    --cols: 8;
  }
}
@media (min-width: 1440px) {
  .content {
    --cols: 12;
  }
}
@media (min-width: 2560px) {
  .content {
    --cols: 18;
  }
}
.prayer-section {
  margin-bottom: 3rem;
  scroll-margin-top: 1rem;
}
.prayer-section h2 {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom: 2px solid #eee;
  padding-bottom: 0.5rem;
}
.he-title {
  direction: rtl;
  font-weight: 400;
  color: #888;
}
.status {
  color: #888;
  font-style: italic;
}
.status.error {
  color: #b00020;
}
.no-translation-note {
  font-style: italic;
  color: #a06b00;
  background: #fff7e0;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
}
.paragraph {
  margin-bottom: 1.25rem;
  text-align: right;
  --english-h: 1.4rem;
}
.hebrew-line {
  display: flex;
  flex-wrap: wrap;
  /* stretch (not flex-end) so every .word-cell in a row gets equal height —
     .word-he then grows to fill its cell and the .word-input row stays aligned. */
  align-items: stretch;
  gap: 0 0.2rem;
  direction: rtl;
  /* The whole siddur (dozens of sections, thousands of words) is rendered at once.
     Skipping layout/paint for off-screen lines keeps resize/scroll reflow cheap.
     Paint containment clips overflowing descendants, so a line hosting an open
     .word-popover drops containment via the :has rule below. */
  content-visibility: auto;
  contain-intrinsic-size: auto 5rem;
}
/* Paint containment clips a .word-popover that overflows the line's box (e.g.
   on the last row), so a line hosting an open popover must drop containment. */
.hebrew-line:has(.word-popover) {
  content-visibility: visible;
}
.note-text {
  display: block;
  flex-basis: 100%;
  font-size: 0.85rem;
  color: #888;
  font-style: italic;
  line-height: 1.6;
  margin: 0.3rem 0;
}
.line-wrap {
  margin: 0 0 0.5rem;
  /* Fixed input height consumed by .word-input in HebrewWord.vue. */
  --word-input-h: 1.4rem;
}
.english {
  display: block;
  flex-basis: 100%;
  color: #333;
  margin: 0.5rem 0 0;
  text-align: right;
  min-height: var(--english-h);
}
.translation-editor {
  margin: 0.3rem 0 0;
}
.edit-translation-btn {
  font-size: 0.75rem;
  color: #666;
  background: none;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 0.15rem 0.5rem;
  cursor: pointer;
}
.edit-translation-btn:hover {
  background: #f0f4ff;
  border-color: #aac;
}
.translation-form {
  margin: 0.5rem 0;
}
.translation-textarea {
  width: 100%;
  box-sizing: border-box;
  font-size: 0.85rem;
  padding: 0.5rem;
  border: 1px solid #ccc;
  border-radius: 6px;
  resize: vertical;
  direction: ltr;
  text-align: left;
  font-family: inherit;
}
.translation-actions {
  display: flex;
  gap: 0.4rem;
  margin-top: 0.4rem;
  flex-wrap: wrap;
}
.t-btn {
  font-size: 0.75rem;
  padding: 0.2rem 0.6rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #f8f8f8;
  cursor: pointer;
}
.t-btn:hover {
  background: #f0f4ff;
}
.t-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.t-discard {
  color: #c00;
  border-color: #eaa;
}
.t-discard:hover {
  background: #fee;
}
.translation-review {
  margin-top: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: #f8f8f8;
  border: 1px solid #eee;
  border-radius: 6px;
  font-size: 0.8rem;
  direction: ltr;
  text-align: left;
}
.review-label {
  font-weight: 600;
  margin: 0.3rem 0 0.1rem;
  color: #888;
}
.review-current {
  margin: 0 0 0.4rem;
  color: #999;
  white-space: pre-wrap;
}
.review-draft {
  margin: 0;
  color: #333;
  white-space: pre-wrap;
}
</style>
