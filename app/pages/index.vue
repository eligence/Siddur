<script setup lang="ts">
// Top-level route: redirect to the first TOC page. (No layout needed — the
// navigateTo fires before the layout would render anything.)
const { data: toc } = await useSiddurToc()
const first = toc.value?.sections[0]
if (first) {
  await navigateTo(sectionPath(first.key), { redirectCode: 302 })
}
</script>

<template>
  <p class="p-8 italic text-neutral-500">Redirecting…</p>
</template>
