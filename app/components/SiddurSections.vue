<script setup lang="ts">
import type { SectionParagraph, TocNode } from '~~/shared/types/siddur'
import { scrollParent } from '~/composables/useInView'
import { useWordPeek } from '~/composables/useWordPeek'

/** Renders one top-level TOC node's leaf sections (the body of a /siddur/<slug> page). */
const props = defineProps<{ leaves: TocNode[] }>()

const { sections, loading, errors, loadSection } = useSiddurSections()
const { getDraft, setDraft, clearDraft, hasDraft } = useTranslationDrafts()
const { getValue } = useWordProgress()
const {
  showEnglish,
  showInputs,
  davenMode,
  columnCount,
  activeRef,
  scrollTargetRef,
} = useSiddurView()

const rootEl = ref<HTMLElement | null>(null)
const route = useRoute()

// --- Translation editor state ---
const editingPara = ref<string | null>(null) // `${ref}::${paraIndex}`
const reviewing = ref(false)

function wordId(ref: string, paraIndex: number, segIndex: number, wordIndex: number) {
  return `${ref}::${paraIndex}::${segIndex}::${wordIndex}`
}

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

// Daven-mode word peek: while translations are hidden, tapping a word cell
// toggles its translation; holding reveals it for the duration of the press.
const canPeek = computed(() => davenMode.value && !showEnglish.value)
const {
  peekId,
  close: closePeek,
  onPointerDown: onPeekDown,
  onContextMenu: onPeekContextMenu,
} = useWordPeek(canPeek)
watch(canPeek, (on) => {
  if (!on) closePeek()
})

// Virtual scrolling: paragraphs render via VirtualBlock, which swaps off-screen ones
// for spacers. Measured heights are cached per view mode + column count, since
// both change a paragraph's height.
const viewMode = computed(() =>
  davenMode.value
    ? showEnglish.value
      ? 'daven-en'
      : 'daven'
    : showInputs.value
      ? 'inputs'
      : showEnglish.value
        ? 'en'
        : 'plain',
)
function paraCacheKey(ref: string, paraIndex: number) {
  return `${viewMode.value}:${columnCount.value}:${paraKey(ref, paraIndex)}`
}
/** Rough spacer height (px) for a paragraph that hasn't been rendered in this mode yet. */
function estimateParaHeight(para: SectionParagraph) {
  const words = para.segments.reduce((n, seg) => n + (seg.type === 'words' ? seg.words.length : 0), 0)
  // Daven cells shrink-wrap to word width (~8 per row); translations grow rows.
  if (davenMode.value) return Math.ceil(words / 8) * (showEnglish.value ? 90 : 50) + 24
  const rows = Math.ceil(words / columnCount.value)
  return rows * (showInputs.value ? 70 : 46) + (showEnglish.value && para.en ? 48 : 0)
}

// --- Lazy loading + active-section tracking ---

// Lazy loading: a section's text is fetched only when its element comes within
// ~2 viewports of the scroll position. Set up after mount, client-side only,
// so the first client render matches the SSR HTML.
let stopLoadObservers: (() => void)[] = []
function setupLoadObservers() {
  stopLoadObservers.forEach((stop) => stop())
  stopLoadObservers = props.leaves.flatMap((leaf) => {
    const el = document.getElementById(sectionElementId(leaf.ref!))
    if (!el) return []
    return [
      observeInView(el, '200% 0px', (entry) => {
        if (entry.isIntersecting) loadSection(leaf.ref!)
      }),
    ]
  })
}

let observer: IntersectionObserver | null = null
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
  for (const leaf of props.leaves) {
    const el = document.getElementById(sectionElementId(leaf.ref!))
    if (el) observer.observe(el)
  }
}

// --- Scroll target (cross-page anchor) ---
// The layout sets scrollTargetRef to a section element id when navigating to a
// leaf on a different page. Sections above it lazy-load and shift layout, so we
// re-scroll as sections arrive until every leaf on the page has settled.

function scrollToPending() {
  const id = scrollTargetRef.value
  if (!id) return
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: 'auto', block: 'start' })
  // Once every leaf has loaded (or failed), layout is stable — stop chasing.
  if (props.leaves.every((l) => sections.value[l.ref!] || errors.value[l.ref!])) {
    scrollTargetRef.value = null
  }
}

onMounted(() => {
  // Honor a bare URL hash (deep link) even without a nav click.
  if (!scrollTargetRef.value && route.hash) scrollTargetRef.value = route.hash.slice(1)
  setupObserver()
  setupLoadObservers()
  if (scrollTargetRef.value) {
    scrollToPending()
  } else {
    scrollParent(rootEl.value!)?.scrollTo({ top: 0 })
  }
  // A manual scroll gesture cancels the pending re-scroll.
  const sp = rootEl.value ? scrollParent(rootEl.value) : null
  const cancelTarget = () => {
    scrollTargetRef.value = null
  }
  sp?.addEventListener('wheel', cancelTarget, { once: true })
  sp?.addEventListener('touchmove', cancelTarget, { once: true })
  onBeforeUnmount(() => {
    sp?.removeEventListener('wheel', cancelTarget)
    sp?.removeEventListener('touchmove', cancelTarget)
  })
})

if (import.meta.client) {
  // Re-scroll toward the pending anchor as lazily loaded sections fill in.
  watch(
    () => props.leaves.map((l) => sections.value[l.ref!] ?? errors.value[l.ref!] ?? null),
    () => nextTick(scrollToPending),
  )
  // Page switch reuses this component (param-only route change) — re-observe
  // the new leaf elements and reset the scroll position.
  watch(
    () => props.leaves,
    () =>
      nextTick(() => {
        setupObserver()
        setupLoadObservers()
        if (scrollTargetRef.value) scrollToPending()
        else scrollParent(rootEl.value!)?.scrollTo({ top: 0 })
      }),
  )
}

onBeforeUnmount(() => {
  observer?.disconnect()
  stopLoadObservers.forEach((stop) => stop())
})
</script>

<template>
  <div ref="rootEl">
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
        <template v-for="(para, i) in sections[leaf.ref!].paragraphs" :key="i">
        <!-- Outside daven mode, instruction-only paragraphs are hidden entirely. -->
        <VirtualBlock
          v-if="davenMode || hasWords(para)"
          class="paragraph"
          :cache-key="paraCacheKey(leaf.ref!, i)"
          :estimate="estimateParaHeight(para)"
        >
          <span v-if="para.en && showEnglish" class="english" v-html="para.en" />

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
            <div
              class="hebrew-line"
              :class="{ daven: davenMode }"
              @pointerdown="onPeekDown"
              @contextmenu="onPeekContextMenu"
            >
              <template v-for="(seg, si) in para.segments" :key="si">
                <!-- Instruction segments render in daven mode only. -->
                <span v-if="seg.type === 'note' && davenMode" class="note-text" v-html="seg.html" />
                <template v-else-if="seg.type === 'words'">
                  <HebrewWord
                    v-for="(word, wi) in seg.words"
                    :key="wi"
                    :id="wordId(leaf.ref!, i, si, wi)"
                    :word="word"
                    :show-input="showInputs"
                    :show-value="showEnglish"
                    :daven="davenMode"
                    :revealed="peekId === wordId(leaf.ref!, i, si, wi)"
                    :sentence-start="wi === 0"
                  />
                </template>
              </template>
            </div>
          </div>
        </VirtualBlock>
        </template>
      </template>

      <p v-else class="status">Not loaded yet…</p>
    </section>
  </div>
</template>

<style scoped>
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
/* Daven mode: cells shrink-wrap to word width; a wider gap leaves room for
   the margin dots sitting at the left of each translation. */
.hebrew-line.daven {
  column-gap: 0.85rem;
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
