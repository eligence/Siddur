# Siddur Learning App — Plan

An app to help learn English translations of the daily Chabad prayers (Weekday Siddur Chabad), sourced from [Sefaria](https://www.sefaria.org/Weekday_Siddur_Chabad%2C_Shacharit%2C_Upon_Arising?lang=bi&lang2=en) via the [Sefaria API](https://developers.sefaria.org/).

Stack: **Nuxt 4** (Vue 3) with **Nuxt UI** + **Tailwind CSS**, server routes as a proxy/cache layer in front of the Sefaria API (no API key required).

---

## Phase 1 — Fetch & Display (done)

Goal: fetch the full `Weekday Siddur Chabad` text and arrange it on a single page, navigable via a table of contents.

### Data source
- **TOC / structure**: `GET https://www.sefaria.org/api/v2/index/Weekday Siddur Chabad`
  Returns a nested schema tree (`Shacharit`, `Blessings`, `Mincha`, `Maariv`, plus misc top-level sections like `Sefirat HaOmer`, `Kiddush Levanah`, etc.). Each leaf node is a `JaggedArrayNode` (depth 1, section = "Paragraph") with a `key`/`title`/`heTitle`.
- **Text per section**: `GET https://www.sefaria.org/api/v3/texts/{ref}?version=hebrew&version=english`
  `{ref}` is built by joining node keys with commas, e.g. `Weekday Siddur Chabad, Shacharit, Upon Arising`.
  - Returns parallel Hebrew/English arrays (one entry per paragraph).
  - **Known gap**: not every section has an English translation yet (e.g. `Upon Arising` currently returns `text: []`). Sections translated so far use the "Sefaria Community Translation" version. These sections render Hebrew-only with a visible "no translation available" note.

### Completed
1. Scaffolded Nuxt 4 project (`package.json`, `nuxt.config.ts`, `app/` dir, `server/` dir).
2. `server/api/siddur/index.get.ts` — fetches and caches the Index (v2) response; transforms it into a simplified TOC tree.
3. `server/api/siddur/text.get.ts?ref=...` — fetches and caches Texts (v3) for a given ref.
4. `app/composables/useSiddur.ts` — client-side fetch helpers with in-memory caching.
5. `app/pages/index.vue` — single page layout: TOC sidebar + scrollable content area with lazy-loaded sections.
6. **Nuxt UI + Tailwind CSS** integrated (`@nuxt/ui` module, `app/assets/css/main.css`, `UApp` wrapper in `app.vue`). Dark mode disabled (`colorMode: false`). Global toggle buttons use `UButton` with Lucide icons.
7. **Scroll-spy**: `IntersectionObserver` tracks the topmost visible section and updates `activeRef` in the TOC. Active TOC item auto-scrolls into view in the sidebar.
8. All sections load on mount with a concurrency cap (5 parallel requests).

---

## Phase 2 — Word-Level Learning (done)

Goal: tokenize the learnable Hebrew text into words, put an input above each word for the user's translation guess, and let them check it by clicking the word (fetched from Sefaria's Lexicon).

### Key rule
Text wrapped in `<small>...</small>` in Sefaria's Hebrew source is **instructional/halachic commentary**, not prayer text — it is excluded from word-input/translation-check features and rendered as plain non-interactive italic notes.

### Completed
1. `shared/types/siddur.ts` — `HebrewSegment` (`{ type: 'note', html }` | `{ type: 'words', words }`) and `LexiconResult`; `SectionParagraph` carries `segments`.
2. `server/utils/sefaria.ts` — `parseHebrewSegments()` splits each paragraph's raw Hebrew HTML on `<small>` boundaries, tokenizing the remaining text into words.
3. **Punctuation merging** — `mergePunctuationTokens()` post-pass merges punctuation-only tokens into neighboring words so they don't render as standalone `.word-he` buttons:
   - Opening brackets/quotes (`\p{Ps}`, `\p{Pi}`) attach to the **next** word.
   - Everything else (sof pasuq, periods, closing brackets) attaches to the **previous** word.
   - A bracket pair wrapping a note (`( <small>note</small> )`) folds both into the note's HTML.
   - Note segments are never touched except in the bracket-pair case.
   - Text cache key versioned (`sefaria:text:v7:`).
4. `server/utils/lexicon.ts` + `server/api/words/[word].get.ts` — proxy/cache Sefaria's Lexicon endpoint, simplified to prioritized glosses (Klein, Jastrow, BDB).
5. `app/composables/useLexicon.ts` — client-side cache + `lookup(word)`; `EDGE_PUNCTUATION` strips all edge punctuation/symbols (including Hebrew-block: maqaf, sof pasuq, geresh) via `\p{P}\p{S}` with the `u` flag.
6. `app/components/HebrewWord.vue` — renders one word cell: input above the Hebrew word, click-to-toggle popover with lexicon definitions.
7. `app/pages/index.vue` — paragraphs render `segments`: notes as italic text, words as `HebrewWord` cells. Global `showEnglish` and `showInputs` toggles (fixed `UButton` at viewport bottom-left).

### Word progress storage
- `app/composables/useWordProgress.ts` — two-layer `localStorage`-backed storage (`siddur:word-progress-v3`):
  - **`variations: Record<word, string[]>`** — shared pool of all guesses ever typed for a Hebrew word (deduped). Shared across every occurrence of the same word.
  - **`selections: Record<id, string>`** — the active value for a specific word-input occurrence (keyed by `ref::para::seg::wordIndex`). Selecting a variation only affects that one input.
- **Value capture**: typed values added to the variations pool on `@blur` only.
- **Variations dropdown**: when 2+ variations exist, a custom dropdown replaces the plain input:
  - Trigger button (centered text) shows the current selection or "Select…" placeholder.
  - Panel lists each variation with a **×** remove button per item (removes from the shared pool and clears all selections using it).
  - Inline "New…" input at the bottom to enter a new value (Enter or **+** button).
  - Click-outside closes the panel.
  - Removing variations that drops the count to ≤1 reverts to the plain input.
- **0–1 variations**: plain text input (pre-filled if 1 variation exists).

### Verified
- `GET /api/siddur/text?ref=...` returns `segments` correctly splitting notes vs. learnable words.
- `GET /api/words/{word}` returns simplified, prioritized lexicon glosses.
- `npx nuxt build` passes cleanly after all changes.

---

## Phase 3 — Test Suite (later)

- Build a word list from the full siddur text: every unique Hebrew word appears exactly once.
- Order the test queue by word frequency, **descending** (most common words tested first).
- Quiz flow: show Hebrew word → user types English translation → check against lexicon/user's saved answer → track correct/incorrect → move to next word.
- Track mastery per word across sessions.

---

## Open questions / decisions to revisit
- Word progress is local-only (`localStorage`). If cross-device sync is needed, a lightweight backend/DB would be required.
- Word tokenization for Hebrew: niqqud/cantillation marks are preserved in the display and stripped only for lexicon lookup. Punctuation is merged into neighboring words at parse time.
- `wordId` is index-based (`ref::para::seg::wordIndex`), so punctuation merges shift indices. Saved selections keyed by `wordId` may misalign after merge changes — content-based IDs would be more robust if needed.

