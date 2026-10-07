export interface WordPeek {
  word: string
  /**
   * Mount point inside the word's `.peek-anchor` span (the word is wrapped in an
   * inline-block so a block line rendered here opens space above the line).
   * Teleport the translation element into it.
   */
  mount: HTMLElement
}

const LONG_PRESS_MS = 450
const TOUCH_HOLD_MS = 300
const DOUBLE_TAP_MS = 350
const DOUBLE_TAP_PX = 24
const MOVE_TOLERANCE_PX = 8
// Words are split on whitespace and maqaf, matching the word-list tokenization.
const BOUNDARY = /[\s\u05BE]/
const HEBREW_LETTER = /[\u05D0-\u05EA]/

interface WordHit {
  word: string
  /** Range spanning exactly the word's characters (inside a single text node). */
  range: Range
}

/** Hebrew word (and a Range over it) under a viewport point in plain text, or null. */
function wordAt(x: number, y: number): WordHit | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  let node: Node | null = null
  let offset = 0
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y)
    if (pos) ({ offsetNode: node, offset } = pos)
  } else if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y)
    if (range) ({ startContainer: node, startOffset: offset } = range)
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null
  // <small> text is instructions, not prayer words.
  if (node.parentElement?.closest('small')) return null

  const text = node.textContent ?? ''
  let start = offset
  let end = offset
  while (start > 0 && !BOUNDARY.test(text[start - 1]!)) start--
  while (end < text.length && !BOUNDARY.test(text[end]!)) end++
  const word = cleanHebrewWord(text.slice(start, end))
  if (!HEBREW_LETTER.test(word)) return null

  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, end)
  const rect = range.getBoundingClientRect()
  // The caret snaps to the nearest position, so confirm the point is actually on the word.
  if (x < rect.left - 2 || x > rect.right + 2 || y < rect.top - 2 || y > rect.bottom + 2) return null
  return { word, range }
}

/**
 * Press-and-hold word lookup for plain-text Hebrew. Mouse: long press. Touch:
 * double-tap-and-hold (so a plain long press keeps native text selection).
 * Bind the returned handlers on the text container; `peek` is set to the pressed
 * word and its anchor position, and cleared on the next press, scroll, or Escape.
 */
export function useWordPeek() {
  const peek = shallowRef<WordPeek | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  let startX = 0
  let startY = 0
  let lastTap: { t: number; x: number; y: number } | null = null
  let anchor: HTMLElement | null = null

  function cancel() {
    clearTimeout(timer)
    timer = undefined
  }

  /** Restore the word's plain text node, dropping the anchor span and mount. */
  function unwrap() {
    if (!anchor) return
    const parent = anchor.parentNode
    const text = anchor.lastChild // word's text node, after the mount div
    if (parent && text) {
      parent.insertBefore(text, anchor)
      parent.normalize()
    }
    anchor.remove()
    anchor = null
  }

  function close() {
    cancel()
    peek.value = null
    unwrap()
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    const container = (e.target as Element | null)?.closest?.('.daven-text') ?? null
    if (!container) return
    cancel()
    let delay = LONG_PRESS_MS
    if (e.pointerType === 'touch') {
      const prev = lastTap
      const isSecondTap =
        !!prev &&
        e.timeStamp - prev.t < DOUBLE_TAP_MS &&
        Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_PX
      if (!isSecondTap) {
        lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY }
        return
      }
      lastTap = null
      delay = TOUCH_HOLD_MS
    }
    startX = e.clientX
    startY = e.clientY
    timer = setTimeout(() => {
      timer = undefined
      const hit = wordAt(startX, startY)
      if (!hit || !container.isConnected) return
      // Drop any selection the browser started during the hold.
      window.getSelection()?.removeAllRanges()
      // Wrap the word in an inline-block: a block line inside it makes the line
      // box grow upward, opening space above the line for the translation.
      const span = document.createElement('span')
      span.className = 'peek-anchor'
      try {
        hit.range.surroundContents(span)
      } catch {
        return
      }
      const mount = document.createElement('div')
      mount.className = 'peek-mount'
      span.insertAdjacentElement('afterbegin', mount)
      anchor = span
      peek.value = { word: hit.word, mount }
    }, delay)
  }

  function onPointerMove(e: PointerEvent) {
    if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_TOLERANCE_PX) cancel()
  }

  /** Suppress the touch long-press context menu while a press is pending or a peek is open. */
  function onContextMenu(e: Event) {
    if (timer || peek.value) e.preventDefault()
  }

  // Any new press (anywhere), scroll, or Escape dismisses the peek.
  function onDocPointerDown() {
    if (peek.value) close()
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') close()
  }

  onMounted(() => {
    document.addEventListener('pointerdown', onDocPointerDown, true)
    document.addEventListener('scroll', close, true)
    document.addEventListener('keydown', onKeyDown)
  })
  onBeforeUnmount(() => {
    cancel()
    document.removeEventListener('pointerdown', onDocPointerDown, true)
    document.removeEventListener('scroll', close, true)
    document.removeEventListener('keydown', onKeyDown)
  })

  return { peek, close, onPointerDown, onPointerMove, onPointerEnd: cancel, onContextMenu }
}
