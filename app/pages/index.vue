<script setup lang="ts">
import type { SectionParagraph, TocNode } from '~~/shared/types/siddur'
import type { NavigationMenuItem } from '@nuxt/ui'
import { useWordPeek } from '~/composables/useWordPeek'

const { data: toc, pending: tocPending, error: tocError } = await useSiddurToc()
const { sections, loading, errors, loadSection } = useSiddurSections()
const { drafts, getDraft, setDraft, clearDraft, hasDraft } = useTranslationDrafts()
const { getValue, getVariations } = useWordProgress()

const activeRef = ref<string | null>(null)
// Global toggles in the fixed action bar: 👁 reveals every translation,
// ✎ reveals every word input.
const showEnglish = ref(false)
const showInputs = ref(false)
// Daven mode: plain flowing Hebrew for reading, no word grid/inputs/translations.
const davenMode = ref(false)

// The view modes are mutually exclusive.
function toggleEnglish() {
  showEnglish.value = !showEnglish.value
  if (showEnglish.value) {
    showInputs.value = false
    davenMode.value = false
  }
}
function toggleInputs() {
  showInputs.value = !showInputs.value
  if (showInputs.value) {
    showEnglish.value = false
    davenMode.value = false
  }
}
function toggleDaven() {
  davenMode.value = !davenMode.value
  if (davenMode.value) {
    showEnglish.value = false
    showInputs.value = false
  }
}

// Daven-mode word peek: long press (mouse) or double-tap-and-hold (touch) a word
// to open space above its line showing the user's own translation (nothing if none).
const {
  peek,
  close: closePeek,
  onPointerDown: onPeekDown,
  onPointerMove: onPeekMove,
  onPointerEnd: onPeekEnd,
  onContextMenu: onPeekContextMenu,
} = useWordPeek()
watch(davenMode, (on) => {
  if (!on) closePeek()
})
/** User's latest saved translation for the peeked word, or '' if none. */
const peekTranslation = computed(() => {
  const p = peek.value
  if (!p) return ''
  const vars = getVariations(p.word)
  return vars[vars.length - 1] ?? ''
})
// A pressed word with no saved translation shows nothing — close the peek so
// its anchor span is unwrapped again.
watchEffect(() => {
  if (peek.value && !peekTranslation.value) closePeek()
})

// Persist daven mode across refreshes. Restored in onMounted (not setup) so the
// client's first render matches the SSR HTML, which always starts with it off.
const DAVEN_STORAGE_KEY = 'siddur:daven-mode'
onMounted(() => {
  try {
    if (localStorage.getItem(DAVEN_STORAGE_KEY) === '1') davenMode.value = true
  } catch {
    // ignore inaccessible storage
  }
  watch(davenMode, (on) => {
    try {
      localStorage.setItem(DAVEN_STORAGE_KEY, on ? '1' : '0')
    } catch {
      // ignore quota/access errors
    }
  })
})

// --- Text style panel ---
const stylePanelOpen = ref(false)

type StyleKey = 'hebrew' | 'translation' | 'note'
interface TextStyle {
  font: string // 'inherit' = element default (Reka forbids '' select values)
  size: number | null // px; null = element default
  color: string | null // null = element default
}

const textStyles = reactive<Record<StyleKey, TextStyle>>({
  hebrew: { font: 'inherit', size: null, color: null },
  translation: { font: 'inherit', size: null, color: null },
  note: { font: 'inherit', size: null, color: null },
})

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

// px equivalents of the CSS defaults, used when stepping from an unset size.
const defaultSizes: Record<StyleKey, number> = { hebrew: 21, translation: 16, note: 14 }

function stepSize(key: StyleKey, delta: number) {
  const s = textStyles[key]
  s.size = Math.min(72, Math.max(8, (s.size ?? defaultSizes[key]) + delta))
}

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
    startSize: textStyles[key].size ?? defaultSizes[key],
    armed: false,
    timer: setTimeout(() => {
      if (sizeDrag) sizeDrag.armed = true
    }, SIZE_DRAG_HOLD_MS),
  }
}

function onSizePointerMove(e: PointerEvent) {
  if (!sizeDrag?.armed || e.pointerId !== sizeDrag.pointerId) return
  const dx = e.clientX - sizeDrag.startX
  const s = textStyles[sizeDrag.key]
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

// Columns per row in the word grid; consumed as --cols by .word-cell.
// (The old .content breakpoints are dead CSS — no element has that class —
// so this is the only thing setting --cols.)
const columnCount = ref(5)

// Persist text styles + column count across refreshes. Restored in onMounted
// (like daven mode) so the client's first render matches the SSR HTML.
const STYLE_STORAGE_KEY = 'siddur:text-styles'
onMounted(() => {
  try {
    const saved = JSON.parse(localStorage.getItem(STYLE_STORAGE_KEY) ?? 'null')
    if (saved && typeof saved === 'object') {
      for (const key of ['hebrew', 'translation', 'note'] as const) {
        const s = saved.styles?.[key]
        if (!s) continue
        if (typeof s.font === 'string') textStyles[key].font = s.font
        if (typeof s.size === 'number' || s.size === null) textStyles[key].size = s.size
        if (typeof s.color === 'string' || s.color === null) textStyles[key].color = s.color
      }
      if (typeof saved.columns === 'number') columnCount.value = Math.min(12, Math.max(2, saved.columns))
    }
  } catch {
    // ignore inaccessible storage / malformed JSON
  }
  watch(
    [textStyles, columnCount],
    () => {
      try {
        localStorage.setItem(STYLE_STORAGE_KEY, JSON.stringify({ styles: textStyles, columns: columnCount.value }))
      } catch {
        // ignore quota/access errors
      }
    },
    { deep: true },
  )
})

// 16 words so the preview wraps onto multiple rows like the real word grid.
const previewWords = 'שְׁמַע יִשְׂרָאֵל יְיָ אֱלֹהֵינוּ יְיָ אֶחָד בָּרוּךְ שֵׁם כְּבוֹד מַלְכוּתוֹ לְעוֹלָם וָעֶד וְאָהַבְתָּ אֵת יְיָ אֱלֹהֶיךָ'.split(' ')

/** CSS custom properties applied on .layout; unset fields fall back to the
    element's own CSS defaults. */
const textStyleVars = computed(() => {
  const vars: Record<string, string> = { '--cols': String(columnCount.value) }
  for (const key of ['hebrew', 'translation', 'note'] as const) {
    const s = textStyles[key]
    if (s.font) vars[`--${key}-font`] = s.font
    // v-model.number can leave '' when the input is cleared — treat as unset.
    if (typeof s.size === 'number' && !Number.isNaN(s.size)) vars[`--${key}-size`] = `${s.size}px`
    if (s.color) vars[`--${key}-color`] = s.color
  }
  return vars
})
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

/** True when the paragraph has at least one word input and every word input
    has a non-empty value. Note-only paragraphs (no inputs) don't qualify. */
function paraInputsFilled(ref: string, para: SectionParagraph, paraIndex: number) {
  let hasWords = false
  const allFilled = para.segments.every((seg, si) => {
    if (seg.type === 'note') return true
    if (seg.words.length) hasWords = true
    return seg.words.every((_, wi) => getValue(wordId(ref, paraIndex, si, wi)).trim() !== '')
  })
  return hasWords && allFilled
}

/** True when the paragraph has prayer text (not just <small> instructions). */
function hasWords(para: SectionParagraph) {
  return para.segments.some((seg) => seg.type === 'words' && seg.words.length > 0)
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

// Lazy loading: a section's text is fetched only when its element comes within
// ~2 viewports of the scroll position (or when picked in the TOC). Set up after
// mount, client-side only, so the first client render matches the SSR HTML.
let stopLoadObservers: (() => void)[] = []
function setupLoadObservers() {
  stopLoadObservers.forEach((stop) => stop())
  stopLoadObservers = leaves.value.flatMap((leaf) => {
    const el = document.getElementById(sectionElementId(leaf.ref!))
    if (!el) return []
    return [
      observeInView(el, '200% 0px', (entry) => {
        if (entry.isIntersecting) loadSection(leaf.ref!)
      }),
    ]
  })
}

// Virtual scrolling: paragraphs render via VirtualBlock, which swaps off-screen ones
// for spacers. Measured heights are cached per view mode + column count, since
// both change a paragraph's height.
const viewMode = computed(() =>
  davenMode.value ? 'daven' : showInputs.value ? 'inputs' : showEnglish.value ? 'en' : 'plain',
)
function paraCacheKey(ref: string, paraIndex: number) {
  return `${viewMode.value}:${columnCount.value}:${paraKey(ref, paraIndex)}`
}
/** Rough spacer height (px) for a paragraph that hasn't been rendered in this mode yet. */
function estimateParaHeight(para: SectionParagraph) {
  const words = para.segments.reduce((n, seg) => n + (seg.type === 'words' ? seg.words.length : 0), 0)
  if (davenMode.value) return Math.ceil(words / 12) * 46
  const rows = Math.ceil(words / columnCount.value)
  return rows * (showInputs.value ? 70 : 46) + (showEnglish.value && para.en ? 48 : 0)
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
  if (import.meta.client) {
    setupObserver()
    setupLoadObservers()
  }
})

// Sections render asynchronously, so re-observe whenever the leaf list changes.
if (import.meta.client) {
  watch(leaves, () =>
    nextTick(() => {
      setupObserver()
      setupLoadObservers()
    }),
  )
}

onBeforeUnmount(() => {
  observer?.disconnect()
  stopLoadObservers.forEach((stop) => stop())
})
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
                <UTooltip text="Text style settings">
                  <UButton
                    icon="tabler:typography"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    :aria-pressed="stylePanelOpen"
                    aria-label="Text style settings"
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
          <section
            v-for="leaf in leaves"
            :id="sectionElementId(leaf.ref!)"
            :data-ref="leaf.ref"
            :key="leaf.ref"
            class="prayer-section"
            :class="{ pending: !sections[leaf.ref!] && !errors[leaf.ref!] }"
          >
        <h2>
          {{ leaf.title }}
          <span class="he-title">{{ leaf.heTitle }}</span>
        </h2>

        <p v-if="loading[leaf.ref!]" class="status">Loading…</p>
        <p v-else-if="errors[leaf.ref!]" class="status error">{{ errors[leaf.ref!] }}</p>

        <template v-else-if="sections[leaf.ref!]">
<!--          <p v-if="!sections[leaf.ref!].hasTranslation" class="no-translation-note">-->
<!--            No English translation is available yet for this section on Sefaria.-->
<!--          </p>-->
          <template v-for="(para, i) in sections[leaf.ref!].paragraphs" :key="i">
          <!-- Outside daven mode, instruction-only paragraphs are hidden entirely. -->
          <VirtualBlock
            v-if="davenMode || hasWords(para)"
            class="paragraph"
            :cache-key="paraCacheKey(leaf.ref!, i)"
            :estimate="estimateParaHeight(para)"
          >
            <span v-if="para.en && showEnglish" class="english" v-html="para.en" />

            <div
              v-if="davenMode"
              class="daven-text"
              dir="rtl"
              @pointerdown="onPeekDown"
              @pointermove="onPeekMove"
              @pointerup="onPeekEnd"
              @pointercancel="onPeekEnd"
              @contextmenu="onPeekContextMenu"
              v-html="para.he"
            />

            <template v-else>
            <!-- Translation editor — only in editing mode (word inputs visible) -->
            <div v-if="showInputs" class="translation-editor">
              <button
                v-if="editingPara !== paraKey(leaf.ref!, i) && paraInputsFilled(leaf.ref!, para, i)"
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
                  <template v-if="seg.type === 'words'">
                    <HebrewWord
                      v-for="(word, wi) in seg.words"
                      :key="wi"
                      :id="wordId(leaf.ref!, i, si, wi)"
                      :word="word"
                      :show-input="showInputs"
                      :show-value="showEnglish"
                      :sentence-start="wi === 0"
                    />
                  </template>
                </template>
              </div>
            </div>
            </template>
          </VirtualBlock>
          </template>
        </template>

        <p v-else class="status">Not loaded yet…</p>
      </section>
        </template>
      </UDashboardPanel>
    </UDashboardGroup>
    <!-- Teleports into .peek-mount inside the word's anchor span (see
         useWordPeek): rendered as a block line inside the inline-block anchor,
         it opens space above the word's line in the text flow. -->
    <Teleport v-if="peek" :to="peek.mount">
      <div v-if="peekTranslation" class="word-peek-line" dir="auto">{{ peekTranslation }}</div>
    </Teleport>
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
/* Unloaded sections reserve a viewport of height so only the few nearest the
   scroll position fall inside the lazy-load margin at once. */
.prayer-section.pending {
  min-height: 100vh;
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
  /* No content-visibility here: VirtualBlock virtualizes paragraphs, and skipped
     rendering would make it measure placeholder heights instead of real ones. */
}
.note-text {
  display: block;
  flex-basis: 100%;
  font-family: var(--note-font, inherit);
  font-size: var(--note-size, 0.85rem);
  font-style: italic;
  color: var(--note-color, #888);
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
  font-family: var(--translation-font, inherit);
  font-size: var(--translation-size, 1rem);
  color: var(--translation-color, #333);
  margin: 0.5rem 0 0;
  text-align: right;
  min-height: var(--english-h);
}
.translation-editor {
  margin: 0.3rem 0 0;
}
.daven-text {
  font-family: var(--hebrew-font, inherit);
  font-size: var(--hebrew-size, 1.5rem);
  color: var(--hebrew-color, inherit);
  line-height: 1;
  text-align: justify;
  /* Disable double-tap zoom so the second tap of double-tap-and-hold reaches us. */
  touch-action: manipulation;
}
/* The pressed word is wrapped in .peek-anchor (imperative DOM, so :deep).
   inline-block + the mount/translation as block lines inside makes the line
   box grow upward — opening space above the word's line for the translation. */
.daven-text :deep(.peek-anchor) {
  display: inline-block;
}
/* width:0 + auto margins center a zero-width box on the anchor (= word width);
   the translation inside sizes to its content and shifts back by half, so it
   stays centered on the word without widening the line. */
.daven-text :deep(.peek-mount) {
  width: 0;
  margin: 0 auto;
}
.word-peek-line {
  display: block;
  width: max-content;
  max-width: 16rem;
  transform: translateX(-50%);
  font-family: var(--translation-font, inherit);
  font-size: var(--translation-size, 1rem);
  color: var(--translation-color, #333);
  line-height: 1.3;
  text-align: center;
  pointer-events: none;
}
.daven-text :deep(small) {
  font-family: var(--note-font, inherit);
  font-size: var(--note-size, 0.85rem);
  font-style: italic;
  color: var(--note-color, #888);
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
