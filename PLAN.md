# Siddur Learning App — Plan

An app to help learn English translations of the daily Chabad prayers (Weekday Siddur Chabad), sourced from [Sefaria](https://www.sefaria.org/Weekday_Siddur_Chabad%2C_Shacharit%2C_Upon_Arising?lang=bi&with=Navigation&lang2=en) via the [Sefaria API](https://developers.sefaria.org/).

Stack: **Nuxt 4** (Vue 3), server routes as a proxy/cache layer in front of the Sefaria API (no API key required).

---

## Phase 1 — Fetch & Display (in progress)

Goal: fetch the full `Weekday Siddur Chabad` text and arrange it on a single page, navigable via a table of contents.

### Data source
- **TOC / structure**: `GET https://www.sefaria.org/api/v2/index/Weekday Siddur Chabad`
  Returns a nested schema tree (`Shacharit`, `Blessings`, `Mincha`, `Maariv`, plus misc top-level sections like `Sefirat HaOmer`, `Kiddush Levanah`, etc.). Each leaf node is a `JaggedArrayNode` (depth 1, section = "Paragraph") with a `key`/`title`/`heTitle`.
- **Text per section**: `GET https://www.sefaria.org/api/v3/texts/{ref}?version=hebrew&version=english`
  `{ref}` is built by joining node keys with commas, e.g. `Weekday Siddur Chabad, Shacharit, Upon Arising`.
  - Returns parallel Hebrew/English arrays (one entry per paragraph).
  - **Known gap**: not every section has an English translation yet (e.g. `Upon Arising` currently returns `text: []`). Sections translated so far use the "Sefaria Community Translation" version. These sections must render Hebrew-only with a visible "no translation available" note — this is expected, not a bug.

### Build steps
1. Scaffold Nuxt 4 project (`package.json`, `nuxt.config.ts`, `app/` dir, `server/` dir).
2. `server/api/siddur/index.get.ts` — fetches and caches the Index (v2) response; transforms it into a simplified TOC tree (id/title/heTitle/children/ref) for the frontend.
3. `server/api/siddur/text.get.ts?ref=...` — fetches and caches Texts (v3) for a given ref; returns `{ he: string[], en: string[] | null }`.
4. `app/composables/useSiddur.ts` — client-side fetch helpers wrapping the two server routes, with in-memory caching per session.
5. `app/pages/index.vue` — single page layout:
   - Left: TOC sidebar (nested, collapsible, built from the index schema).
   - Right: scrollable content area. Clicking a TOC entry lazy-loads that section's text and scrolls to it (each section rendered as an anchor'd block once loaded).
6. Basic styling: RTL Hebrew block above/beside LTR English translation per paragraph; anchor navigation; active TOC highlighting.
7. Smoke test: run dev server, click through several TOC entries (including a no-translation section) to confirm correct rendering.

### Out of scope for Phase 1
- Editable inputs, word-level interaction, lexicon lookups, testing/quiz features (see Phase 2/3).

---

## Phase 2 — Word-Level Learning (in progress)

Goal: tokenize the learnable Hebrew text into words, put an input above each word for the user's translation guess, and let them check it by clicking the word (fetched from Sefaria's Lexicon).

### Key rule
Text wrapped in `<small>...</small>` in Sefaria's Hebrew source is **instructional/halachic commentary**, not prayer text — it is excluded from word-input/translation-check features and rendered as plain non-interactive italic notes.

### Build steps (done)
1. `shared/types/siddur.ts` — added `HebrewSegment` (`{ type: 'note', html }` | `{ type: 'words', words }`) and `LexiconResult`; `SectionParagraph` now carries `segments`.
2. `server/utils/sefaria.ts` — `parseHebrewSegments()` splits each paragraph's raw Hebrew HTML on `<small>` boundaries, tokenizing the remaining (learnable) text into words by whitespace.
3. `server/utils/lexicon.ts` + `server/api/words/[word].get.ts` — proxy/cache Sefaria's `GET /api/words/{word}` Lexicon endpoint, simplified to `{ headword, lexicon, definitions[] }[]`, prioritizing concise dictionaries (Klein, Jastrow) over verbose biblical ones (BDB).
4. `app/composables/useWordProgress.ts` — reactive, `localStorage`-backed map of the user's typed guesses, keyed by `ref::paragraphIndex::segmentIndex::wordIndex` (persists across reloads).
5. `app/composables/useLexicon.ts` — client-side cache + `lookup(word)` calling `/api/words/:word`; strips leading/trailing punctuation before lookup, keeps niqqud.
6. `app/components/HebrewWord.vue` — renders one word cell: text input **above** the Hebrew word, click-to-toggle popover showing lexicon definitions below.
7. `app/pages/index.vue` — paragraphs now render `segments`: `note` segments as italic non-interactive text, `words` segments as a wrapped row of `HebrewWord` cells. Full paragraph-level English translation is hidden by default behind a "Show translation" toggle (so the per-word exercise isn't spoiled immediately).

### Verified
- `GET /api/siddur/text?ref=...` returns `segments` correctly splitting notes vs. learnable words (confirmed via curl on `Upon Arising` and `Morning Blessings`).
- `GET /api/words/{word}` returns simplified, prioritized lexicon glosses (confirmed via curl on ברוך).
- Dev server rebuilds cleanly with no errors after adding these files (stale filesystem route/data cache under `.nuxt/cache` was cleared after the schema change — worth remembering during iteration).

### Not yet verified
- Actual browser interaction (typing in inputs, clicking words, popover positioning, localStorage persistence) — needs manual check in-browser since curl can't execute client JS.

## Phase 3 — Test Suite (later)

- Build a word list from the full siddur text: every unique Hebrew word appears exactly once.
- Order the test queue by word frequency, **descending** (most common words tested first).
- Quiz flow: show Hebrew word → user types English translation → check against lexicon/user's saved answer → track correct/incorrect → move to next word.
- Track mastery per word across sessions.

---

## Open questions / decisions to revisit
- Where to persist user progress (local-only vs. lightweight backend/DB) — decide before Phase 2 input persistence.
- Word tokenization approach for Hebrew (stripping niqqud/punctuation consistently) — needed before Phase 2 per-word inputs and Phase 3 word list dedup.
