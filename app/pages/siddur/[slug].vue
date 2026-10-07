<script setup lang="ts">
// One page per top-level TOC node: renders its leaf sections and prev/next
// pagination. Route param changes reuse this component — SiddurSections
// watches its `leaves` prop and re-observes/scrolls accordingly.
definePageMeta({ layout: 'siddur' })

const route = useRoute()
const { data: toc } = await useSiddurToc()

const pages = computed(() => toc.value?.sections ?? [])
const slug = computed(() => String(route.params.slug ?? ''))
const index = computed(() => pages.value.findIndex((n) => slugFor(n.key) === slug.value))
const node = computed(() => (index.value >= 0 ? pages.value[index.value] : undefined))
const leaves = computed(() => {
  const n = node.value
  return n ? flattenLeaves(n.children ?? [n]) : []
})
const prev = computed(() => (index.value > 0 ? pages.value[index.value - 1] : undefined))
const next = computed(() =>
  index.value >= 0 && index.value < pages.value.length - 1 ? pages.value[index.value + 1] : undefined,
)

// Unknown slug → first page (SSR redirect or client-side nav).
if (toc.value && index.value < 0) {
  const first = pages.value[0]
  if (first) await navigateTo(sectionPath(first.key), { redirectCode: 302 })
}

useHead(() => ({
  title: node.value ? `${node.value.title} · Weekday Siddur Chabad` : 'Weekday Siddur Chabad',
}))
</script>

<template>
  <div>
    <!-- Group pages get a heading; leaf pages' own section h2 covers it. -->
    <header v-if="node?.children" class="page-heading">
      <h2>{{ node.title }} <span class="he-title">{{ node.heTitle }}</span></h2>
    </header>

    <SiddurSections v-if="node" :leaves="leaves" />

    <nav v-if="node" class="pager" aria-label="Section pagination">
      <UButton
        v-if="prev"
        :to="sectionPath(prev.key)"
        icon="i-lucide-chevron-left"
        color="neutral"
        variant="outline"
        size="sm"
      >
        {{ prev.title }}
      </UButton>
      <UButton
        v-if="next"
        :to="sectionPath(next.key)"
        trailing-icon="i-lucide-chevron-right"
        color="neutral"
        variant="outline"
        size="sm"
      >
        {{ next.title }}
      </UButton>
      <span v-else />
    </nav>
  </div>
</template>

<style scoped>
.page-heading h2 {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom: 2px solid #ccc;
  padding-bottom: 0.5rem;
  margin: 0 0 2rem;
}
.he-title {
  direction: rtl;
  font-weight: 400;
  color: #888;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 1.5rem 0 0.5rem;
  border-top: 1px solid #eee;
}
</style>
