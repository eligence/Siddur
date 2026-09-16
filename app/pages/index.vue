<script setup lang="ts">
import type { TocNode } from '../../shared/types/siddur'

const { data: toc, pending: tocPending, error: tocError } = await useSiddurToc()
const { sections, loading, errors, loadSection } = useSiddurSections()

const openKeys = ref<Record<string, boolean>>({})
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

/** Scroll the active TOC item into view inside the sidebar. */
watch(activeRef, (ref) => {
  if (!ref) return
  nextTick(() => {
    const el = document.querySelector(`.toc-leaf.active`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
})

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
    <div v-if="sidebarOpen" class="sidebar-backdrop" @click="sidebarOpen = false" />

    <aside class="sidebar" :class="{ 'sidebar-open': sidebarOpen }">
      <button
        type="button"
        class="sidebar-toggle"
        :aria-expanded="sidebarOpen"
        aria-label="Toggle table of contents"
        @click="sidebarOpen = !sidebarOpen"
      >
        <span class="menu-icon" aria-hidden="true">{{ sidebarOpen ? '✕' : '☰' }}</span>
        <span class="toggle-label">Contents</span>
      </button>

      <div class="sidebar-body" :aria-hidden="!sidebarOpen">
        <h1 class="app-title">Weekday Siddur Chabad</h1>
        <p v-if="tocPending">Loading table of contents…</p>
        <p v-else-if="tocError">Failed to load table of contents.</p>
        <TocTree
          v-else-if="toc"
          v-model:open-keys="openKeys"
          :nodes="toc.sections"
          :active-ref="activeRef"
          @select="handleSelect"
        />
      </div>
    </aside>

    <main class="content">
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
                    />
                  </template>
                </template>
              </div>
            </div>
          </div>
        </template>

        <p v-else class="status">Not loaded yet…</p>
      </section>
    </main>

    <UButton
      :icon="showEnglish ? 'i-lucide-eye' : 'i-lucide-eye-off'"
      :color="showEnglish ? 'primary' : 'neutral'"
      variant="outline"
      size="sm"
      class="fixed bottom-4 start-4 z-50"
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
      class="fixed bottom-4 start-13 z-50"
      :aria-pressed="showInputs"
      :aria-label="showInputs ? 'Hide all input fields' : 'Show all input fields'"
      :title="showInputs ? 'Hide all input fields' : 'Show all input fields'"
      @click="showInputs = !showInputs"
    />
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  min-height: 100vh;
}
.sidebar {
  width: 300px;
  flex-shrink: 0;
  padding: 1rem;
  border-inline-end: 1px solid #ddd;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  background: #fff;
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
.sidebar-toggle {
  display: none;
}
.sidebar-backdrop {
  display: none;
}

@media (max-width: 768px) {
  .sidebar-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 40;
    opacity: 1;
    transition: opacity 0.25s ease;
  }

  /* On mobile the sidebar itself is the toggle: collapsed it's a small tab flush
     in the page corner containing just the icon + label; clicking it grows the
     same element, both horizontally and vertically, into the full off-canvas TOC
     panel. The upper-left corner never moves — only size and the rounded
     bottom-right corner animate. */
  .sidebar {
    position: fixed;
    top: 0;
    inset-inline-start: 0;
    width: 8.5rem;
    height: 2.75rem;
    padding: 0;
    border-inline-end: none;
    border-radius: 0;
    border-end-end-radius: 1.25rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
    overflow: hidden;
    z-index: 50;
    transition:
      width 0.28s ease,
      height 0.28s ease,
      border-end-end-radius 0.28s ease;
  }
  .sidebar.sidebar-open {
    width: 80vw;
    max-width: 320px;
    height: 100vh;
    border-end-end-radius: 0;
  }

  .sidebar-toggle {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    height: 2.75rem;
    flex-shrink: 0;
    background: none;
    border: none;
    padding: 0 1rem;
    font-size: 0.9rem;
    cursor: pointer;
  }
  .menu-icon {
    font-size: 1.1rem;
    line-height: 1;
  }

  .sidebar-body {
    padding: 0 1rem 1rem;
    height: calc(100% - 2.75rem);
    overflow-y: auto;
  }

  .content {
    padding-top: 4rem;
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
</style>
