/** Tracks which single HebrewWord popover (by its unique occurrence id) is currently open. */
export function useWordPopover() {
  const openId = useState<string | null>('word-popover-open-id', () => null)

  function isOpen(id: string) {
    return openId.value === id
  }

  function toggle(id: string) {
    openId.value = openId.value === id ? null : id
  }

  function close() {
    openId.value = null
  }

  return { openId, isOpen, toggle, close }
}
