<script setup lang="ts">
const props = defineProps<{
  id: string
  word: string
  showInput: boolean
}>()

const { getValue, setValue } = useWordProgress()
const { lookup, stateFor } = useLexicon()
const { isOpen, toggle } = useWordPopover()

const open = computed(() => isOpen(props.id))
const lookupState = computed(() => stateFor(props.word))

const guess = computed({
  get: () => getValue(props.word),
  set: (value: string) => setValue(props.word, value),
})

function checkWord() {
  toggle(props.id)
  if (isOpen(props.id)) lookup(props.word)
}

/** Tab/Shift+Tab moves directly between word inputs, skipping the .word-he
    buttons and inputs hidden by a row's inputs toggle. */
function onInputTab(e: KeyboardEvent) {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('.word-input')).filter(
    (el) => !el.closest('.input-hidden'),
  )
  const idx = inputs.indexOf(e.currentTarget as HTMLInputElement)
  inputs[idx + (e.shiftKey ? -1 : 1)]?.focus()
}
</script>

<template>
  <span class="word-cell" :class="{ 'input-hidden': !showInput }">
    <input
      v-model="guess"
      class="word-input"
      type="text"
      autocomplete="off"
      spellcheck="false"
      :aria-label="`English translation guess for ${word}`"
      @keydown.tab.prevent="onInputTab"
    />
    <button type="button" class="word-he" dir="rtl" @click="checkWord">
      {{ word }}
    </button>

    <div v-if="open" class="word-popover">
      <p v-if="lookupState?.loading">Looking up…</p>
      <p v-else-if="lookupState?.error" class="popover-error">{{ lookupState.error }}</p>
      <template v-else-if="lookupState?.results">
        <p v-if="lookupState.results.length === 0" class="popover-empty">No dictionary entry found.</p>
        <div v-for="(entry, i) in lookupState.results" :key="i" class="popover-entry">
          <span class="popover-lexicon">{{ entry.lexicon }}</span>
          <ul>
            <li v-for="(def, j) in entry.definitions" :key="j">{{ def }}</li>
          </ul>
        </div>
      </template>
    </div>
  </span>
</template>

<style scoped>
.word-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  /* Fixed-width column: exactly --cols cells fill a row. The extra +0.2rem
     compensates for the row gap on .hebrew-line so widths come out exact. */
  flex: 0 0 calc((100% + 0.2rem) / var(--cols, 5) - 0.2rem);
  margin-bottom: 0.6rem;
}
.word-input {
  width: 100%;
  min-width: 3.5rem;
  box-sizing: border-box;
  /* Fixed height lets .inputs-toggle offset exactly one input row (see
     --word-input-h on .line-wrap in index.vue). */
  height: var(--word-input-h, 1.4rem);
  font-size: 0.75rem;
  padding: 0.15rem 0.3rem;
  margin-bottom: 0.2rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  direction: ltr;
  text-align: center;
}
.word-input:focus {
  background-color: rgb(180 215 255 / 0.15);
  border-color: transparent;
}
/* display (not visibility) collapses the input so hidden rows stay compact. */
.input-hidden .word-input {
  display: none;
}
.word-he {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.3rem;
  line-height: 1.7;
  padding: 0;
  color: inherit;
  border-radius: 4px;
  /* Grow to fill the cell's stretched height so all .word-he in a row are
     equal height; the word itself stays top-centered. */
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}
.word-he:hover {
  background: #f0f4ff;
}
.word-popover {
  position: absolute;
  top: 100%;
  inset-inline-start: 0;
  z-index: 10;
  min-width: 220px;
  max-width: 320px;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  padding: 0.5rem 0.65rem;
  direction: ltr;
  text-align: start;
  font-size: 0.85rem;
  white-space: normal;
}
.popover-entry + .popover-entry {
  margin-top: 0.4rem;
  padding-top: 0.4rem;
  border-top: 1px solid #eee;
}
.popover-lexicon {
  font-weight: 600;
  font-size: 0.75rem;
  color: #888;
  text-transform: uppercase;
}
.popover-entry ul {
  margin: 0.15rem 0 0;
  padding-inline-start: 1.1rem;
}
.popover-error {
  color: #b00020;
}
.popover-empty {
  color: #888;
  font-style: italic;
}
</style>
