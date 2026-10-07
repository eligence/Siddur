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
8. ~~All sections load on mount with a concurrency cap~~ → replaced by lazy loading + virtual scrolling:
   - **Lazy loading**: `observeInView()` (`app/composables/useInView.ts`, shared `IntersectionObserver`s rooted at the dashboard panel's scroll container) fetches a section only when it comes within ~2 viewports (`200% 0px`), or when picked in the TOC. Unloaded sections reserve `min-height: 100vh` so only a few nearby ones load at once.
   - **Virtual scrolling**: each paragraph renders inside `app/components/VirtualBlock.vue`, which mounts its content only within ~1.5 viewports (`150% 0px`) and otherwise renders a spacer at the last measured height (cached per view mode + column count + paragraph in `virtualBlockHeights`), falling back to a word-count estimate. Visibility state is per-block, so scrolling and daven-mode toggles only re-render nearby paragraphs.
   - `content-visibility: auto` was removed from `.hebrew-line` / `.daven-text`: skipped rendering would make VirtualBlock cache placeholder heights.
   - Named `VirtualBlock` (not `LazyBlock`) because Nuxt reserves the `Lazy` component prefix.

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
4. `server/utils/lexicon.ts` + `server/api/words/[word].get.ts` — proxy/cache Sefaria's Lexicon endpoint, simplified to prioritized glosses (Klein, Jastrow, BDB). Sefaria only matches headwords and its (mostly Tanakh) word-form table, so liturgical forms like `שֶׁהֶחֱזַֽרְתָּ` return nothing — resolved instead by a **precomputed table** + verified fallbacks:
   - **`server/assets/lexicon.json`** — `{ forms: lexiconKey → query ('' = no entry), lemmas: query → LexiconResult[] }` for all 7,224 unique `lexiconKey()`s in the siddur; `fetchLexiconEntry` serves table hits with zero network calls. `lexiconKey()` (in `shared/utils/hebrew.ts`) = `cleanHebrewWord` + NFC + cantillation/meteg/masoretic-mark removal, so vowelization variants collapse to one key. Maqaf-joined tokens (the table keys are split parts) resolve by combining each part's entries.
   - **Build**: `npm run lexicon:build` (`scripts/build-lexicon.ts`, needs the dev server on :3000) walks the `/api/siddur/words` forms, resolves each via Sefaria (raw queries memoized in gitignored `.cache/sefaria-words.json` so interrupted runs resume), and writes `lexicon.json` + `lexicon.unmatched.txt` (no-entry keys by frequency — mostly Aramaic `ד` forms; fill via `lexicon.overrides.json`: `{ key: query }`, `''` = confirmed missing).
   - **Fallbacks** (`lexiconLookupCandidates`): `שֶׁ`-strip → prefix stems (deepest first) → consonantal guesses ranked by edit cost — perfect/future endings and pronominal suffixes removed, hif'il `ה/נ` + future `א/י/נ/ת` + participle `מ` peeled, hif'il-`י`/participle-`ו` matres dropped, weak letters restored (hollow ו/י, final-ה, dropped `נ`/`י`, geminates), noun bases restored (`ת→ה`). Root guesses are verified: an entry only counts if its headword's consonantal key equals the guess — the check that rejected the "horseradish" match.
   - **Runtime**: table first; on a miss (non-siddur words only) `resolveLexicon()` does a live cached lookup with the same fallbacks (`sefaria:word:v4:`).
5. `app/composables/useLexicon.ts` — client-side cache + `lookup(word)`; `EDGE_PUNCTUATION` strips all edge punctuation/symbols (including Hebrew-block: maqaf, sof pasuq, geresh) via `\p{P}\p{S}` with the `u` flag.
6. `app/components/HebrewWord.vue` — renders one word cell: input above the Hebrew word, click-to-toggle popover with lexicon definitions.
7. `app/pages/index.vue` — paragraphs render `segments`: notes as italic text, words as `HebrewWord` cells. Global `showEnglish` and `showInputs` toggles in the navbar. All navbar buttons are icon-only with `UTooltip` labels (Export shows the draft count in its tooltip; wrapped in a span so the tooltip works while disabled).
8. **Text style settings** (fonts, sizes, colors per Hebrew/Translation/Note + column count) persist in `localStorage` (`siddur:text-styles`), restored on mount and validated per field.
9. **Daven mode** (book icon in the navbar) — renders each paragraph's raw `he` HTML as plain flowing RTL text for reading (no word grid, inputs, translations or editor); `<small>` notes styled as notes. Outside daven mode, instruction notes are hidden, and instruction-only paragraphs are skipped entirely. Mutually exclusive with the English/inputs views — those toggles sit in the navbar's left slot (after the sidebar toggle and text style settings) and are hidden while daven mode is on; honors the text style panel's Hebrew/Note settings. State persists in `localStorage` (`siddur:daven-mode`), restored on mount to avoid hydration mismatches.
   - **Word peek** (`app/composables/useWordPeek.ts`): long press (mouse, 450ms) or double-tap-and-hold (touch, 2nd tap within 350ms/24px, then 300ms hold) on a word opens space above its line showing the user's translation. The word is found via `caretPositionFromPoint`/`caretRangeFromPoint`, expanded to whitespace/maqaf boundaries; `<small>` instructions are ignored. On fire, the word's `Range` is `surroundContents`-ed into an inline-block `.peek-anchor` span with a `.peek-mount` div inside; the page teleports `.word-peek-line` (a block line, Translation text style, `width:0` mount + `translateX(-50%)` keeps it centered on the word without widening the line) into it — the line box grows upward, pushing text down instead of overlaying. Closing unwraps the span back to the plain text node. Shows only the user's latest saved variation (no lexicon fallback); words without a saved value are unwrapped immediately. Dismissed on the next press, scroll, Escape, or leaving daven mode. `.daven-text` uses `touch-action: manipulation` so double-tap doesn't zoom; plain long press keeps native text selection on phones.

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

## Phase 2.5 — Paragraph Translation Drafting & Export (in progress)

Goal: let users compose full-paragraph English translations and export them as a CSV for submission to Sefaria.

### Sefaria write access
Sefaria's public API is read-only — no API keys are needed for documented endpoints. Write endpoints (`/api/texts/...`) require an internal `apikey` tied to a Sefaria staff account, which is not publicly available. Following Sefaria's own community translation workflow (see [Sefaria Translation Studio](https://github.com/av1m/sefaria-translation-studio)), reviewed translations are exported as a CSV in Sefaria's bulk-import format (`Ref,text`) and emailed to `developers@sefaria.org` for import.

### Design decisions
- **Local draft → review → export flow**: user drafts in a textarea, reviews against the loaded translation, then exports all drafts as a CSV. Drafts persist in `localStorage`.
- **CSV format**: `Ref,text` header row, one row per paragraph. Segment refs are 1-indexed: `{sectionRef} {n}` (e.g. `Weekday Siddur Chabad, Shacharit, Upon Arising 1`).
- **Global export button**: an "Export" button in the action bar downloads all drafts as `siddur-translations.csv`. Shows a count of pending drafts.

### Build steps
1. `app/composables/useTranslationDrafts.ts` — `localStorage`-backed draft storage keyed by `{ref}::{paragraphIndex}`.
2. `app/pages/index.vue` — per-paragraph translation editor UI:
   - "Add Translation" / "Edit Draft" button on each paragraph (visible when `showEnglish` is on).
   - Opens a `<textarea>` pre-filled with existing translation or draft.
   - "Review" shows the current translation alongside the draft.
   - "Export" button in the action bar downloads all drafts as CSV.
3. Smoke test with `npx nuxt build`.

---

## Phase 3 — Test Suite (in progress)

- Build a word list from the full siddur text: every unique Hebrew word appears exactly once.
- Order the test queue by word frequency, **descending** (most common words tested first).
- Quiz flow: show Hebrew word → user types English translation → check against lexicon → track correct/incorrect → move to next word.
- Track mastery per word across sessions.

### Key rule — one-way sync
When the user answers a quiz word **correctly**, that answer is added to the word's shared variations pool in `useWordProgress`, so it appears in the siddur display. This does **not** work in the other direction: siddur inputs never count as quiz answers or affect quiz mastery.

### Build steps
1. `shared/utils/hebrew.ts` — `normalizeHebrewWord()` (consonantal key, shared with word-progress variations) and `cleanHebrewWord()` (edge-punctuation strip for lexicon lookups), used by both client and server.
2. `server/utils/wordlist.ts` + `server/api/siddur/words.get.ts` — fetches every section, counts words by normalized key (notes excluded), sorts by count desc. Cached as `sefaria:wordlist:v6` (not cached if any section fails).
   - **Hebrew only**: tokens whose key isn't purely Hebrew letters (e.g. Omer day numbers `1`–`49`) are skipped. Forms are NFC-normalized and `normalizeHebrewWord()` applies NFKD, so presentation-form letters (e.g. `בּ` U+FB31) key the same as base letters.
   - **Maqaf (`־`)**: maqaf-joined tokens (e.g. `עַל֯־פְּנֵי`) are split and each word counted separately. The siddur display keeps them as one token.
   - **Prefix folding (Otiyot HaShimush)**: `hebrewPrefixStems()` in `shared/utils/hebrew.ts` peels formative prefixes in order `ו` → `ב/כ/ל` or `מ` → `ה`, using the pointing rules (e.g. `מִ` + dagesh / `מֵ` before gutturals; `הַ` + dagesh / `הָ` / `הֶ` (only before a qamats/hataf-qamats `ה/ח/ע`, so hif'il `הֶחֱ` stays intact); `בַּ/לָ` with an absorbed article). A leading `ו` is **always** stripped as "and", with no standalone check. For `ב/כ/ל/מ/ה`, a form is folded into the deepest stem whose key **also occurs standalone** in the siddur — this guards root letters (`בָּרוּךְ` stays intact since `רוך` never appears alone).
   - Display form = most frequent unprefixed form. `QuizWord.forms` lists all folded forms (shown in `/words`).
   - Not handled: `שֶׁ` ("that") and future-tense verb prefixes (`א/י/נ/ת`), which change the word rather than add a particle.
3. `app/composables/useQuizProgress.ts` — `localStorage` (`siddur:quiz-progress-v1`) per-key `{ correct, incorrect, streak, lastSeen }`. Mastered = streak ≥ `MASTERY_STREAK` (3).
4. `app/utils/answerMatch.ts` — `matchesLexicon()`: normalized exact match against comma/semicolon-split lexicon glosses, or single-word match inside a short gloss. Stopwords (`to`, `the`, `a`…) and plural `s` ignored.
5. `app/pages/quiz.vue` — session queue = unmastered words in frequency order. Check → auto-graded result + lexicon definitions; user can override ("I was right" / "Mark incorrect"). Next commits the result (correct → `addVariation`; incorrect → requeued 5 cards later). Skip advances without recording. Enter = Check / Next.
6. "Quiz" button in the siddur navbar links to `/quiz`.
7. `app/pages/words.vue` — full word list in frequency order (rank, word, count, quiz streak / mastered badge, saved variations). "Show mastered only" switch filters to mastered words; rank stays the global frequency rank. Clickable "א–ת" (word) / "Count" / "#" headers toggle Hebrew alphabetical order (by consonantal stem key, final letters ך ם ן ף ץ sorted as their regular forms) vs. frequency; chevrons show direction and clicking the active header flips it. When sorted by Word, rows are grouped into a collapsible accordion with one section per first letter (collapsed by default, heading shows letter + word count). Each section has its own hue, stepping evenly around the color wheel from א to ת; rows use a light tint, the header a more opaque tint of the same hue. A "Show variants" switch (on by default) toggles the grey list of folded vowelized/prefixed forms; when off, only the normalized consonantal key is shown. A "Words only" switch hides all personal/quiz UI (streak, translations, mastered badge/filter, Quiz link), leaving just Word / Count / #. Linked from the siddur navbar and quiz header.

---

## Open questions / decisions to revisit
- Word progress is local-only (`localStorage`). If cross-device sync is needed, a lightweight backend/DB would be required.
- Word tokenization for Hebrew: niqqud/cantillation marks are preserved in the display and stripped only for lexicon lookup. Punctuation is merged into neighboring words at parse time.
- `wordId` is index-based (`ref::para::seg::wordIndex`), so punctuation merges shift indices. Saved selections keyed by `wordId` may misalign after merge changes — content-based IDs would be more robust if needed.

