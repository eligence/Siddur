<script setup lang="ts">
import type { TocNode } from '../../shared/types/siddur'

defineProps<{
  nodes: TocNode[]
  activeRef?: string | null
}>()

const emit = defineEmits<{ select: [ref: string] }>()

const openKeys = defineModel<Record<string, boolean>>('openKeys', { default: () => ({}) })

function toggle(key: string) {
  openKeys.value[key] = !openKeys.value[key]
}
</script>

<template>
  <ul class="toc-list">
    <li v-for="node in nodes" :key="node.key">
      <template v-if="node.children">
        <button type="button" class="toc-branch" @click="toggle(node.key)">
          <span class="chevron" :class="{ open: openKeys[node.key] }">▸</span>
          <span class="toc-title">{{ node.title }}</span>
          <span class="toc-he">{{ node.heTitle }}</span>
        </button>
        <TocTree
          v-if="openKeys[node.key]"
          v-model:open-keys="openKeys"
          :nodes="node.children"
          :active-ref="activeRef"
          class="toc-children"
          @select="(ref) => emit('select', ref)"
        />
      </template>
      <template v-else>
        <button
          type="button"
          class="toc-leaf"
          :class="{ active: activeRef === node.ref }"
          @click="emit('select', node.ref!)"
        >
          <span class="toc-title">{{ node.title }}</span>
          <span class="toc-he">{{ node.heTitle }}</span>
        </button>
      </template>
    </li>
  </ul>
</template>

<style scoped>
.toc-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.toc-children {
  padding-inline-start: 1rem;
}
.toc-branch,
.toc-leaf {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  text-align: start;
  background: none;
  border: none;
  padding: 0.35rem 0.5rem;
  cursor: pointer;
  border-radius: 6px;
  font-size: 0.9rem;
  color: inherit;
}
.toc-branch:hover,
.toc-leaf:hover {
  background: var(--toc-hover-bg, #eee);
}
.toc-leaf.active {
  background: var(--toc-active-bg, #dbe9ff);
  font-weight: 600;
}
.chevron {
  display: inline-block;
  transition: transform 0.15s ease;
  font-size: 0.7rem;
  opacity: 0.6;
}
.chevron.open {
  transform: rotate(90deg);
}
.toc-title {
  flex: 1;
}
.toc-he {
  direction: rtl;
  color: var(--toc-he-color, #888);
  font-size: 0.85rem;
}
</style>
