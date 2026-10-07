export type StyleKey = 'hebrew' | 'translation' | 'note'
export interface TextStyle {
  font: string // 'inherit' = element default (Reka forbids '' select values)
  size: number | null // px; null = element default
  color: string | null // null = element default
}

const DAVEN_STORAGE_KEY = 'siddur:daven-mode'
const STYLE_STORAGE_KEY = 'siddur:text-styles'

// px equivalents of the CSS defaults, used when stepping from an unset size.
export const defaultSizes: Record<StyleKey, number> = { hebrew: 21, translation: 16, note: 14 }

/**
 * Shared siddur view state — view-mode toggles, text styles, the section under
 * the viewport top, and the pending scroll target — persisted via useState so
 * it survives client-side navigation between /section/<slug> pages.
 * localStorage restore runs once on first mount so the client's first render
 * still matches the SSR HTML (everything starts at defaults).
 */
export function useSiddurView() {
  // Global toggles in the navbar: 👁 reveals every translation, ✎ reveals
  // every word input, book = plain flowing Hebrew for reading.
  const showEnglish = useState('siddur-view:english', () => false)
  const showInputs = useState('siddur-view:inputs', () => false)
  const davenMode = useState('siddur-view:daven', () => false)

  const textStyles = useState<Record<StyleKey, TextStyle>>('siddur-view:styles', () => ({
    hebrew: { font: 'inherit', size: null, color: null },
    translation: { font: 'inherit', size: null, color: null },
    note: { font: 'inherit', size: null, color: null },
  }))
  // Columns per row in the word grid; consumed as --cols by .word-cell.
  const columnCount = useState('siddur-view:columns', () => 5)

  // Ref of the leaf section nearest the viewport top (sidebar highlight).
  const activeRef = useState<string | null>('siddur-view:active-ref', () => null)
  // Element id a nav selection should scroll to after the target page mounts.
  const scrollTargetRef = useState<string | null>('siddur-view:scroll-target', () => null)

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

  function stepSize(key: StyleKey, delta: number) {
    const s = textStyles.value[key]
    s.size = Math.min(72, Math.max(8, (s.size ?? defaultSizes[key]) + delta))
  }

  /** CSS custom properties applied on .layout; unset fields fall back to the
      element's own CSS defaults. */
  const textStyleVars = computed(() => {
    const vars: Record<string, string> = { '--cols': String(columnCount.value) }
    for (const key of ['hebrew', 'translation', 'note'] as const) {
      const s = textStyles.value[key]
      if (s.font) vars[`--${key}-font`] = s.font
      // v-model.number can leave '' when the input is cleared — treat as unset.
      if (typeof s.size === 'number' && !Number.isNaN(s.size)) vars[`--${key}-size`] = `${s.size}px`
      if (s.color) vars[`--${key}-color`] = s.color
    }
    return vars
  })

  // Restore persisted prefs once on first mount; then persist changes.
  if (import.meta.client) {
    const restored = useState('siddur-view:restored', () => false)
    onMounted(() => {
      if (restored.value) return
      restored.value = true
      try {
        if (localStorage.getItem(DAVEN_STORAGE_KEY) === '1') davenMode.value = true
      } catch {
        // ignore inaccessible storage
      }
      try {
        const saved = JSON.parse(localStorage.getItem(STYLE_STORAGE_KEY) ?? 'null')
        if (saved && typeof saved === 'object') {
          for (const key of ['hebrew', 'translation', 'note'] as const) {
            const s = saved.styles?.[key]
            if (!s) continue
            if (typeof s.font === 'string') textStyles.value[key].font = s.font
            if (typeof s.size === 'number' || s.size === null) textStyles.value[key].size = s.size
            if (typeof s.color === 'string' || s.color === null) textStyles.value[key].color = s.color
          }
          if (typeof saved.columns === 'number') columnCount.value = Math.min(12, Math.max(2, saved.columns))
        }
      } catch {
        // ignore inaccessible storage / malformed JSON
      }
      watch(davenMode, (on) => {
        try {
          localStorage.setItem(DAVEN_STORAGE_KEY, on ? '1' : '0')
        } catch {
          // ignore quota/access errors
        }
      })
      watch(
        [textStyles, columnCount],
        () => {
          try {
            localStorage.setItem(
              STYLE_STORAGE_KEY,
              JSON.stringify({ styles: textStyles.value, columns: columnCount.value }),
            )
          } catch {
            // ignore quota/access errors
          }
        },
        { deep: true },
      )
    })
  }

  return {
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
  }
}
