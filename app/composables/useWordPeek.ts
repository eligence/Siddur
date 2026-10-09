/** Presses shorter than this count as taps: they leave the reveal stuck open. */
const TAP_MS = 350
const MOVE_TOLERANCE_PX = 8

/**
 * Word-peek for the daven-mode grid (translations off). `pointerdown` on a
 * `.word-cell` sets `peekId` to its data-word-id immediately:
 *
 * - Tap (release < TAP_MS): reveal stays open — tap the same cell again, tap
 *   another word, or tap empty space to dismiss.
 * - Hold (release >= TAP_MS): reveal hides on release.
 *
 * Dragging >8px mid-press, pointercancel, or scroll always clears. Because the
 * word's click handler is inert in daven mode (see HebrewWord's `daven` prop),
 * no click-swallowing is needed. Bind `onPointerDown`/`onContextMenu` on the
 * grid container; move/up/cancel are tracked on document.
 */
export function useWordPeek(active: Ref<boolean>) {
  const peekId = ref<string | null>(null)
  let startX = 0
  let startY = 0
  let pressStart = 0
  let pressedId: string | null = null
  let wasRevealed = false

  function close() {
    pressedId = null
    peekId.value = null
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    pressedId = null
    if (!active.value) {
      peekId.value = null
      return
    }
    const cell = (e.target as Element | null)?.closest?.('.word-cell')
    const id = cell?.getAttribute('data-word-id')
    if (!cell || !id) {
      peekId.value = null
      return
    }
    startX = e.clientX
    startY = e.clientY
    pressStart = e.timeStamp
    pressedId = id
    wasRevealed = peekId.value === id
    window.getSelection()?.removeAllRanges()
    peekId.value = id
  }

  function onDocPointerMove(e: PointerEvent) {
    if (!pressedId) return
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_TOLERANCE_PX) close()
  }

  function onDocPointerUp(e: PointerEvent) {
    if (!pressedId) return
    if (e.timeStamp - pressStart < TAP_MS) {
      // Tap: keep the reveal, unless the cell was already revealed (toggle off).
      if (wasRevealed) peekId.value = null
    } else {
      // Held press: the reveal ends with the hold.
      peekId.value = null
    }
    pressedId = null
  }

  /** Suppress the touch long-press context menu during an active press. */
  function onContextMenu(e: Event) {
    if (pressedId) e.preventDefault()
  }

  onMounted(() => {
    document.addEventListener('pointermove', onDocPointerMove)
    document.addEventListener('pointerup', onDocPointerUp)
    document.addEventListener('pointercancel', close)
    document.addEventListener('scroll', close, true)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('pointermove', onDocPointerMove)
    document.removeEventListener('pointerup', onDocPointerUp)
    document.removeEventListener('pointercancel', close)
    document.removeEventListener('scroll', close, true)
  })

  return { peekId, close, onPointerDown, onContextMenu }
}
