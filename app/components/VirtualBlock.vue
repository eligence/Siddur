<script setup lang="ts">
import { observeInView, virtualBlockHeights } from '~/composables/useInView'

/**
 * Virtualized block: renders its slot only while within `margin` of the scroll
 * viewport; otherwise renders an empty spacer at the last measured height for
 * `cacheKey` (or `estimate` if never measured). Visibility state lives here, so
 * scrolling only re-renders the blocks that change, not the whole page.
 */
const props = withDefaults(defineProps<{ cacheKey: string; estimate: number; margin?: string }>(), {
  margin: '150% 0px',
})

const el = ref<HTMLElement | null>(null)
const visible = ref(false)
let stop: (() => void) | undefined

onMounted(() => {
  stop = observeInView(el.value!, props.margin, (entry) => {
    if (entry.isIntersecting) visible.value = true
    else if (visible.value) {
      // Record the real rendered height so the spacer keeps scroll position stable.
      virtualBlockHeights.set(props.cacheKey, entry.boundingClientRect.height)
      visible.value = false
    }
  })
})
onBeforeUnmount(() => stop?.())

// Plain function (not computed): virtualBlockHeights isn't reactive, and this is
// re-read on every render where the spacer shows.
function spacerHeight() {
  return `${virtualBlockHeights.get(props.cacheKey) ?? props.estimate}px`
}
</script>

<template>
  <div ref="el">
    <slot v-if="visible" />
    <div v-else :style="{ height: spacerHeight() }" aria-hidden="true" />
  </div>
</template>
