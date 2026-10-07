<script setup lang="ts">
import type { TocNode } from '~~/shared/types/siddur'
import type { NavigationMenuItem } from '@nuxt/ui'
import { defaultSizes, type StyleKey } from '~/composables/useSiddurView'

const { data: toc, pending: tocPending, error: tocError } = await useSiddurToc()
const route = useRoute()
const {
  showEnglish,
  showInputs,
  davenMode,
  toggleEnglish,
  toggleInputs,
  toggleDaven,
  textStyles,
  columnCount,
  stepSize,
  textStyleVars,
  activeRef,
  scrollTargetRef,
} = useSiddurView()
const { drafts } = useTranslationDrafts()

const sidebarOpen = ref(false)
const stylePanelOpen = ref(false)

// --- Sidebar navigation: one page per top-level TOC node ---
function goToLeaf(top: TocNode, leaf: TocNode) {
  sidebarOpen.value = false
  if (!leaf.ref) return
  const elId = sectionElementId(leaf.ref)
  if (route.params.slug === slugFor(top.key)) {
    // Already on the leaf's page — scroll straight to the section.
    activeRef.value = leaf.ref
    nextTick(() => {
      document.getElementById(elId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  } else {
    // The section page scrolls here once it mounts (and re-settles as
    // lazily loaded sections above it fill in).
    scrollTargetRef.value = elId
    navigateTo({ path: sectionPath(top.key), hash: `#${elId}` })
  }
}

function leafItems(node: TocNode, top: TocNode): NavigationMenuItem[] {
  return flattenLeaves(node.children ?? []).map((leaf) => ({
    label: leaf.title,
    active: activeRef.value === leaf.ref,
    onSelect: (e: Event) => {
      e.preventDefault()
      goToLeaf(top, leaf)
    },
  }))
}

const navItems = computed<NavigationMenuItem[]>(() =>
  (toc.value?.sections ?? []).map((node) => {
    const children = leafItems(node, node)
    if (children.length) {
      return { label: node.title, defaultOpen: true, children }
    }
    // Top-level leaf — the item itself is the page link.
    return {
      label: node.title,
      active: route.params.slug === slugFor(node.key),
      onSelect: (e: Event) => {
        e.preventDefault()
        sidebarOpen.value = false
        navigateTo(sectionPath(node.key))
      },
    }
  }),
)

// --- Text style panel ---
const styleTargets: { key: StyleKey; label: string }[] = [
  { key: 'hebrew', label: 'Hebrew text' },
  { key: 'translation', label: 'Translations' },
  { key: 'note', label: 'Notes' },
]

// NOTE: Reka SelectItem throws on empty-string values, so 'inherit' is the
// sentinel for "element default" — font-family: inherit is equivalent.
const fontOptions = [
  { label: 'Default', value: 'inherit' },
  { label: 'Serif', value: 'serif' },
  { label: 'Sans-serif', value: 'sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Times New Roman', value: "'Times New Roman', serif" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier New', value: "'Courier New', monospace" },
  { label: 'David', value: "David, 'Times New Roman', serif" },
  { label: 'Frank Ruhl Libre', value: "'Frank Ruhl Libre', serif" },
]

/** Drag scrubbing on the size field: press-and-HOLD (~300ms) arms the drag,
    then horizontal movement adjusts the value (1px per 5px dragged). A short
    click just focuses the input for typing. Pointer capture keeps the drag
    alive off-element. */
const SIZE_DRAG_HOLD_MS = 300
const SIZE_DRAG_PX_PER_UNIT = 5
let sizeDrag: {
  key: StyleKey
  pointerId: number
  startX: number
  startSize: number
  armed: boolean
  timer: ReturnType<typeof setTimeout>
} | null = null

function onSizePointerDown(key: StyleKey, e: PointerEvent) {
  // Suppress immediate focus/text-selection; a short click focuses on release.
  e.preventDefault()
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  sizeDrag = {
    key,
    pointerId: e.pointerId,
    startX: e.clientX,
    startSize: textStyles.value[key].size ?? defaultSizes[key],
    armed: false,
    timer: setTimeout(() => {
      if (sizeDrag) sizeDrag.armed = true
    }, SIZE_DRAG_HOLD_MS),
  }
}

function onSizePointerMove(e: PointerEvent) {
  if (!sizeDrag?.armed || e.pointerId !== sizeDrag.pointerId) return
  const dx = e.clientX - sizeDrag.startX
  const s = textStyles.value[sizeDrag.key]
  s.size = Math.min(72, Math.max(8, sizeDrag.startSize + Math.round(dx / SIZE_DRAG_PX_PER_UNIT)))
}

function onSizePointerUp(e: PointerEvent) {
  if (!sizeDrag || sizeDrag.pointerId !== e.pointerId) return
  clearTimeout(sizeDrag.timer)
  // Released before the hold armed the drag → treat as a click to edit.
  if (!sizeDrag.armed) (e.currentTarget as HTMLInputElement).focus()
  sizeDrag = null
}

function onSizePointerCancel(e: PointerEvent) {
  if (sizeDrag?.pointerId === e.pointerId) {
    clearTimeout(sizeDrag.timer)
    sizeDrag = null
  }
}

// 16 words so the preview wraps onto multiple rows like the real word grid.
const previewWords = 'שְׁמַע יִשְׂרָאֵל יְיָ אֱלֹהֵינוּ יְיָ אֶחָד בָּרוּךְ שֵׁם כְּבוֹד מַלְכוּתוֹ לְעוֹלָם וָעֶד וְאָהַבְתָּ אֵת יְיָ אֱלֹהֶיךָ'.split(' ')

// --- Translation drafts CSV export ---
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
</script>

<template>
  <div class="layout" :style="textStyleVars">
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
              <UTooltip text="Toggle sidebar">
                <UDashboardSidebarCollapse class="hidden lg:flex" />
              </UTooltip>
              <USlideover
                v-model:open="stylePanelOpen"
                side="right"
                title="Text styles"
                :ui="{ content: 'w-screen max-w-none sm:w-[calc(100vw-2rem)] sm:max-w-lg' }"
              >
                <!-- Default slot is the trigger — Reka coordinates it with the
                     outside-click dismiss so toggling can't reopen the panel. -->
                <UTooltip text="Settings">
                  <UButton
                    icon="tabler:settings"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    :aria-pressed="stylePanelOpen"
                    aria-label="TSettings"
                  />
                </UTooltip>
                <!-- Explicit close: sets stylePanelOpen directly rather than
                     relying on the update:open emit. -->
                <template #close>
                  <UButton
                    icon="i-lucide-x"
                    color="neutral"
                    variant="ghost"
                    aria-label="Close text styles"
                    @click="stylePanelOpen = false"
                  />
                </template>
                <template #body>
                  <section v-for="t in styleTargets" :key="t.key" class="style-section">
                    <h3 class="style-section-title">{{ t.label }}</h3>
                    <div class="style-bar">
                      <USelect
                        v-model="textStyles[t.key].font"
                        :items="fontOptions"
                        variant="ghost"
                        size="sm"
                        class="style-font-select"
                        aria-label="Font family"
                      />
                      <span class="style-sep" />
                      <UButton
                        icon="i-lucide-minus"
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        aria-label="Decrease font size"
                        @click="stepSize(t.key, -1)"
                      />
                      <input
                        v-model.number="textStyles[t.key].size"
                        class="style-size-input"
                        type="number"
                        min="8"
                        max="72"
                        :placeholder="String(defaultSizes[t.key])"
                        aria-label="Font size in pixels (hold and drag left/right to adjust)"
                        title="Hold and drag left/right to adjust"
                        @pointerdown="onSizePointerDown(t.key, $event)"
                        @pointermove="onSizePointerMove"
                        @pointerup="onSizePointerUp"
                        @pointercancel="onSizePointerCancel"
                      />
                      <UButton
                        icon="i-lucide-plus"
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        aria-label="Increase font size"
                        @click="stepSize(t.key, 1)"
                      />
                      <span class="style-sep" />
                      <label class="style-color" title="Text color">
                        <span
                          class="style-color-glyph"
                          :style="{ borderBottomColor: textStyles[t.key].color || 'currentColor' }"
                        >A</span>
                        <!-- :value/@input instead of v-model: type=color rejects
                             an empty string, and null means "unset". -->
                        <input
                          type="color"
                          class="style-color-input"
                          :value="textStyles[t.key].color || '#000000'"
                          @input="textStyles[t.key].color = ($event.target as HTMLInputElement).value"
                        />
                      </label>
                    </div>
                  </section>
                  <section class="style-section">
                    <h3 class="style-section-title">Columns per row — {{ columnCount }}</h3>
                    <USlider v-model="columnCount" :min="2" :max="12" :step="1" />
                  </section>
                  <!-- Live preview — the slideover overlays the content on
                       mobile, and it teleports outside .layout so the style
                       vars must be re-applied here. -->
                  <div class="style-preview" :style="textStyleVars">
                    <p class="style-section-title">Preview</p>
                    <p class="preview-note">On Shabbat add:</p>
                    <p class="preview-translation">Blessed are You, Lord our God</p>
                    <div class="preview-hebrew" dir="rtl">
                      <span v-for="(w, i) in previewWords" :key="i" class="preview-word">{{ w }}</span>
                    </div>
                  </div>
                </template>
              </USlideover>
              <!-- Translation/input views only apply to the word grid, not daven mode. -->
              <template v-if="!davenMode">
                <UTooltip :text="showEnglish ? 'Hide translations' : 'Show translations'">
                  <UButton
                    :icon="showEnglish ? 'tabler:letter-a' : 'tabler:alphabet-hebrew'"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    :aria-pressed="showEnglish"
                    :aria-label="showEnglish ? 'Hide translations' : 'Show translations'"
                    @click="toggleEnglish"
                  />
                </UTooltip>
                <UTooltip :text="showInputs ? 'Hide input fields' : 'Show input fields'">
                  <UButton
                    :icon="showInputs ? 'i-lucide-pencil' : 'i-lucide-pencil-off'"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    :aria-pressed="showInputs"
                    :aria-label="showInputs ? 'Hide input fields' : 'Show input fields'"
                    @click="toggleInputs"
                  />
                </UTooltip>
              </template>
            </template>
            <template #right>
              <template v-if="!stylePanelOpen">
              <UTooltip :text="davenMode ? 'Exit daven mode' : 'Daven mode — plain Hebrew for reading'">
                <UButton
                  icon="i-lucide-book-open"
                  color="neutral"
                  :variant="davenMode ? 'solid' : 'outline'"
                  size="sm"
                  :aria-pressed="davenMode"
                  :aria-label="davenMode ? 'Exit daven mode' : 'Daven mode'"
                  @click="toggleDaven"
                />
              </UTooltip>
              <!-- Wrapped in a span: a disabled button doesn't fire the hover
                   events the tooltip needs. -->
              <UTooltip :text="`Export${draftCount > 0 ? ` (${draftCount})` : ''}`">
                <span class="inline-flex">
                  <UButton
                    icon="i-lucide-download"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    :disabled="draftCount === 0"
                    :aria-label="`Export ${draftCount} draft${draftCount === 1 ? '' : 's'} as CSV`"
                    @click="exportDrafts"
                  />
                </span>
              </UTooltip>
              <UTooltip text="Quiz">
                <UButton
                  to="/quiz"
                  icon="i-lucide-graduation-cap"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  aria-label="Quiz"
                />
              </UTooltip>
              <UTooltip text="Words">
                <UButton
                  to="/words"
                  icon="i-lucide-list-ordered"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  aria-label="Words"
                />
              </UTooltip>
              </template>
            </template>

          </UDashboardNavbar>
        </template>

        <template #body>
          <slot />
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
/* --- Text style panel (Docs-style formatting bar per target) --- */
.style-section + .style-section {
  margin-top: 1.25rem;
}
.style-section-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #888;
  margin: 0 0 0.4rem;
}
.style-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  width: fit-content;
  padding: 3px;
  border: 1px solid #e2e5ea;
  border-radius: 8px;
  background: #fff;
}
.style-sep {
  width: 1px;
  align-self: stretch;
  margin: 2px 3px;
  background: #e2e5ea;
}
.style-font-select {
  width: 8rem;
}
.style-size-input {
  width: 2.2rem;
  border: none;
  font-size: 0.8rem;
  text-align: center;
  -moz-appearance: textfield;
  appearance: textfield;
  /* Horizontal drag scrubs the value; user-select:none keeps the drag from
    highlighting the text. pan-y preserves vertical page scroll on touch. */
  cursor: ew-resize;
  user-select: none;
  touch-action: pan-y;
}
.style-size-input::-webkit-outer-spin-button,
.style-size-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.style-color {
  position: relative;
  display: flex;
  align-items: center;
  padding: 0 6px;
  cursor: pointer;
}
.style-color-glyph {
  font-size: 0.85rem;
  font-weight: 600;
  line-height: 1.1;
  border-bottom: 3px solid;
}
.style-color-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.style-preview {
  margin-top: 2.5rem;
  text-align: center;
}
.preview-hebrew {
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.2rem;
  direction: rtl;
  font-family: var(--hebrew-font, inherit);
  font-size: var(--hebrew-size, 1.3rem);
  color: var(--hebrew-color, inherit);
  margin: 0.3rem 0;
}
.preview-word {
  /* Same sizing formula as .word-cell so the preview wraps like the real grid
    and demos the columns slider. */
  flex: 0 0 calc((100% + 0.2rem) / var(--cols, 5) - 0.2rem);
  text-align: center;
}
.preview-translation {
  font-family: var(--translation-font, inherit);
  font-size: var(--translation-size, 1rem);
  color: var(--translation-color, #333);
  margin: 0.3rem 0;
}
.preview-note {
  font-family: var(--note-font, inherit);
  font-size: var(--note-size, 0.85rem);
  font-style: italic;
  color: var(--note-color, #888);
  margin: 0.3rem 0;
}
</style>
