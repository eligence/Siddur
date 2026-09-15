<script setup lang="ts">
import type { TocNode } from '../../shared/types/siddur'

const { data: toc, pending: tocPending, error: tocError } = await useSiddurToc()
const { sections, loading, errors, loadSection } = useSiddurSections()

const openKeys = ref<Record<string, boolean>>({})
const activeRef = ref<string | null>(null)

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

watch(
  leaves,
  (list) => {
    if (list.length) loadAllSections(list.map((l) => l.ref!))
  },
  { immediate: true },
)

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
            <p class="hebrew" dir="rtl" v-html="para.he" />
            <p v-if="para.en" class="english" v-html="para.en" />
          </div>
        </template>
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
}
.hebrew {
  font-size: 1.3rem;
  line-height: 1.9;
  margin: 0 0 0.35rem;
}
.english {
  color: #333;
  margin: 0;
}
</style>
