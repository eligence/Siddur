<script setup lang="ts">
const props = defineProps<{
  id: string
  word: string
}>()

const { getValue, setValue } = useWordProgress()
const { lookup, stateFor } = useLexicon()
const { isOpen, toggle } = useWordPopover()

const open = computed(() => isOpen(props.id))
const lookupState = computed(() => stateFor(props.word))

const guess = computed({
  get: () => getValue(props.id),
  set: (value: string) => setValue(props.id, value),
})

function checkWord() {
  toggle(props.id)
  if (isOpen(props.id)) lookup(props.word)
}
</script>

<template>
  <span class="word-cell">
    <input
      v-model="guess"
      class="word-input"
      type="text"
      autocomplete="off"
      spellcheck="false"
      :aria-label="`English translation guess for ${word}`"
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
  flex: 1 1 3.5rem;
  margin-bottom: 0.6rem;
}
.word-input {
  width: 100%;
  min-width: 3.5rem;
  box-sizing: border-box;
  font-size: 0.75rem;
  padding: 0.15rem 0.3rem;
  margin-bottom: 0.2rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  direction: ltr;
  text-align: center;
}
.word-input:focus {
  outline: 2px solid #4a90e2;
  border-color: transparent;
}
.word-he {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.3rem;
  line-height: 1.7;
  padding: 0;
  color: inherit;
  text-align: center;
  border-radius: 4px;
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
