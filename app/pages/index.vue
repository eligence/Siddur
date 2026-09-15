<script setup lang="ts">
import type { SectionParagraph, TocNode } from '../../shared/types/siddur'

const { data: toc, pending: tocPending, error: tocError } = await useSiddurToc()
const { sections, loading, errors, loadSection } = useSiddurSections()

const openKeys = ref<Record<string, boolean>>({})
const activeRef = ref<string | null>(null)
const revealed = ref<Record<string, boolean>>({})
// Word inputs start hidden; the ✎ toggle reveals them per paragraph.
const inputsShown = ref<Record<string, boolean>>({})
const sidebarOpen = ref(false)

function paragraphId(ref: string, index: number) {
  return `${ref}::${index}`
}

function wordId(ref: string, paraIndex: number, segIndex: number, wordIndex: number) {
  return `${ref}::${paraIndex}::${segIndex}::${wordIndex}`
}

function paragraphHasWords(para: SectionParagraph) {
  return para.segments.some((s) => s.type === 'words' && s.words.length > 0)
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
            <div class="paragraph-tools">
              <button
                v-if="para.en"
                type="button"
                class="reveal-toggle"
                :class="{ active: revealed[paragraphId(leaf.ref!, i)] }"
                :aria-pressed="revealed[paragraphId(leaf.ref!, i)]"
                :aria-label="revealed[paragraphId(leaf.ref!, i)] ? 'Hide translation' : 'Show translation'"
                :title="revealed[paragraphId(leaf.ref!, i)] ? 'Hide translation' : 'Show translation'"
                @click="revealed[paragraphId(leaf.ref!, i)] = !revealed[paragraphId(leaf.ref!, i)]"
              >
                👁
              </button>
              <button
                v-if="paragraphHasWords(para)"
                type="button"
                class="inputs-toggle"
                :class="{ active: inputsShown[paragraphId(leaf.ref!, i)] }"
                :aria-pressed="inputsShown[paragraphId(leaf.ref!, i)]"
                :aria-label="inputsShown[paragraphId(leaf.ref!, i)] ? 'Hide input fields' : 'Show input fields'"
                :title="inputsShown[paragraphId(leaf.ref!, i)] ? 'Hide input fields' : 'Show input fields'"
                @click="inputsShown[paragraphId(leaf.ref!, i)] = !inputsShown[paragraphId(leaf.ref!, i)]"
              >
                ✎
              </button>
            </div>

            <div class="hebrew-line" :class="{ 'inputs-hidden': !inputsShown[paragraphId(leaf.ref!, i)] }">
              <span v-if="para.en && revealed[paragraphId(leaf.ref!, i)]" class="english" v-html="para.en" />
              <template v-for="(seg, si) in para.segments" :key="si">
                <span v-if="seg.type === 'note'" class="note-text" dir="rtl" v-html="seg.html" />
                <template v-else>
                  <HebrewWord
                    v-for="(word, wi) in seg.words"
                    :key="wi"
                    :id="wordId(leaf.ref!, i, si, wi)"
                    :word="word"
                  />
                </template>
              </template>
            </div>
          </div>
        </template>

        <p v-else class="status">Not loaded yet…</p>
      </section>
    </main>
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
  /* Extra right padding leaves room for the .paragraph-tools column that
     overflows each paragraph's right edge, plus the vertical scrollbar. */
  padding: 1.5rem 4rem 1.5rem 2rem;
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
  position: relative;
}
.hebrew-line {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0 0.2rem;
  margin: 0 0 0.5rem;
  direction: rtl;
  /* The whole siddur (dozens of sections, thousands of words) is rendered at once.
     Skipping layout/paint for off-screen lines keeps resize/scroll reflow cheap.
     Containment lives here rather than on .prayer-section/.paragraph because
     paint containment clips overflowing descendants — the reveal-toggle is
     positioned outside its paragraph's box and must stay visible. */
  content-visibility: auto;
  contain-intrinsic-size: auto 5rem;
}
.note-text {
  flex-basis: 100%;
  font-size: 0.85rem;
  color: #888;
  font-style: italic;
  line-height: 1.6;
  margin: 0.3rem 0;
}
.paragraph-tools {
  position: absolute;
  left: 100%;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding-inline-start: 0.3rem;
}
.reveal-toggle,
.inputs-toggle {
  background: none;
  border: 1px solid #ccc;
  border-radius: 999px;
  font-size: 0.75rem;
  padding: 0.2rem 0.7rem;
  cursor: pointer;
  color: #555;
}
.reveal-toggle:hover,
.inputs-toggle:hover {
  background: #f0f4ff;
}
/* visibility (not display) keeps the word grid from reflowing when toggled.
   :deep is required because .word-input lives inside the HebrewWord child. */
.inputs-hidden :deep(.word-input) {
  visibility: hidden;
}
.english {
  display: block;
  flex-basis: 100%;
  color: #333;
  margin: 0.5rem 0 0;
  text-align: right;
}
</style>
