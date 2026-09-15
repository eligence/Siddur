<script setup lang="ts">
import type { TocNode } from '../../shared/types/siddur'

const { data: toc, pending: tocPending, error: tocError } = await useSiddurToc()
const { sections, loading, errors, loadSection } = useSiddurSections()

const openKeys = ref<Record<string, boolean>>({})
const activeRef = ref<string | null>(null)
const revealed = ref<Record<string, boolean>>({})

function paragraphId(ref: string, index: number) {
  return `${ref}::${index}`
}

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
  nextTick(() => {
    document.getElementById(sectionElementId(ref))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
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
            <div class="hebrew-line">
              <template v-for="(seg, si) in para.segments" :key="si">
                <span v-if="para.en && revealed[paragraphId(leaf.ref!, i)]" class="english" v-html="para.en" />
                <span v-if="seg.type === 'note'" class="note-text hebrew-line" dir="rtl" v-html="seg.html" />
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

            <button
              v-if="para.en"
              type="button"
              class="reveal-toggle"
              @click="revealed[paragraphId(leaf.ref!, i)] = !revealed[paragraphId(leaf.ref!, i)]"
            >
              {{ revealed[paragraphId(leaf.ref!, i)] ? 'Hide translation' : 'Show translation' }}
            </button>
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
}
.app-title {
  font-size: 1.1rem;
  margin: 0 0 1rem;
}
.content {
  flex: 1;
  padding: 1.5rem 2rem;
  max-width: 900px;
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
}
.hebrew-line {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  margin: 0 0 0.5rem;
  text-align: right;
}
.note-text {
  font-size: 0.85rem;
  color: #888;
  font-style: italic;
  line-height: 1.6;
  margin: 0.3rem 0;
  flex-basis: 100%;
}
.reveal-toggle {
  background: none;
  border: 1px solid #ccc;
  border-radius: 999px;
  font-size: 0.75rem;
  padding: 0.2rem 0.7rem;
  cursor: pointer;
  color: #555;
}
.reveal-toggle:hover {
  background: #f0f4ff;
}
.english {
  display: block;
  flex-basis: 100%;
  color: #333;
  margin: 0.5rem 0 0;
  text-align: right;
}
</style>
