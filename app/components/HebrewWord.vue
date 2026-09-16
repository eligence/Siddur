<script setup lang="ts">
const props = defineProps<{
  id: string
  word: string
  showInput: boolean
}>()

const { getValue, setValue, getVariations, addVariation, removeVariation } = useWordProgress()
const { lookup, stateFor } = useLexicon()
const { isOpen, toggle } = useWordPopover()

const open = computed(() => isOpen(props.id))
const lookupState = computed(() => stateFor(props.word))
const variations = computed(() => getVariations(props.word))

const guess = computed({
  get: () => getValue(props.id),
  set: (value: string) => setValue(props.id, value),
})

const dropdownOpen = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)
const newValue = ref('')

function onDocumentClick(e: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    dropdownOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', onDocumentClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))

// 0 variations → plain input. 1 variation → plain input pre-filled.
// 2+ variations → custom dropdown replaces the input.
const showSelect = computed(() => variations.value.length > 1)

function onInputBlur() {
  addVariation(props.word, guess.value)
}

function selectVariation(value: string) {
  setValue(props.id, value)
  dropdownOpen.value = false
}

function removeVariationItem(value: string) {
  removeVariation(props.word, value)
}

function submitNewValue() {
  const v = newValue.value.trim()
  if (v) {
    addVariation(props.word, v)
    setValue(props.id, v)
    newValue.value = ''
  }
  dropdownOpen.value = false
}

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
      v-if="!showSelect"
      v-model="guess"
      class="word-input"
      type="text"
      autocomplete="off"
      spellcheck="false"
      :aria-label="`English translation guess for ${word}`"
      @keydown.tab.prevent="onInputTab"
      @blur="onInputBlur"
    />
    <div v-else ref="dropdownRef" class="variation-dropdown">
      <button
        type="button"
        class="word-input variation-trigger"
        :class="{ placeholder: !guess }"
        @click="dropdownOpen = !dropdownOpen"
      >
        {{ guess || 'Select…' }}
      </button>
      <div v-if="dropdownOpen" class="variation-panel">
        <button
          v-for="v in variations"
          :key="v"
          type="button"
          class="variation-option"
          :class="{ active: v === guess }"
          @click="selectVariation(v)"
        >
          <span class="variation-option-text">{{ v }}</span>
          <span
            class="variation-option-remove"
            role="button"
            tabindex="-1"
            aria-label="Remove this variation"
            @click.stop="removeVariationItem(v)"
          >×</span>
        </button>
        <div class="variation-new">
          <input
            v-model="newValue"
            class="word-input variation-new-input"
            type="text"
            placeholder="New…"
            autocomplete="off"
            spellcheck="false"
            @keydown.enter.prevent="submitNewValue"
          />
          <button type="button" class="variation-add" @click="submitNewValue">+</button>
        </div>
      </div>
    </div>
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
.input-hidden .word-input,
.input-hidden .variation-dropdown {
  display: none;
}
.variation-dropdown {
  position: relative;
  margin-bottom: 0.2rem;
}
.variation-trigger {
  cursor: pointer;
  text-align: center;
  background: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.variation-trigger.placeholder {
  color: #999;
}
.variation-panel {
  position: absolute;
  top: 100%;
  inset-inline-start: 0;
  z-index: 20;
  min-width: 100%;
  max-width: 240px;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  padding: 0.2rem;
  direction: ltr;
}
.variation-option {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  width: 100%;
  padding: 0.15rem 0.3rem;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 0.75rem;
  text-align: start;
  border-radius: 3px;
}
.variation-option:hover {
  background: #f0f4ff;
}
.variation-option.active {
  background: #e0e8ff;
  font-weight: 600;
}
.variation-option-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.variation-option-remove {
  flex: 0 0 auto;
  color: #c00;
  font-size: 0.9rem;
  line-height: 1;
  padding: 0 0.15rem;
  border-radius: 3px;
}
.variation-option-remove:hover {
  background: #fee;
}
.variation-new {
  display: flex;
  gap: 0.2rem;
  margin-top: 0.2rem;
  padding-top: 0.2rem;
  border-top: 1px solid #eee;
}
.variation-new-input {
  flex: 1;
  min-width: 0;
  margin-bottom: 0;
  height: 1.2rem;
  font-size: 0.7rem;
}
.variation-add {
  flex: 0 0 auto;
  width: 1.2rem;
  height: 1.2rem;
  font-size: 0.8rem;
  line-height: 1;
  padding: 0;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #f8f8f8;
  cursor: pointer;
}
.variation-add:hover {
  background: #f0f4ff;
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
