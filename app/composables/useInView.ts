type InViewCallback = (entry: IntersectionObserverEntry) => void

/** Shared IntersectionObservers, one per (scroll root, rootMargin) pair. */
const observers = new Map<Element | null, Map<string, IntersectionObserver>>()
const callbacks = new WeakMap<Element, InViewCallback>()

/**
 * Nearest scrollable ancestor. The siddur scrolls inside a dashboard panel, not
 * the window, and rootMargin only extends the *root* — targets are still clipped
 * by scrolling ancestors — so the panel itself must be the observer root.
 */
export function scrollParent(el: Element): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(p).overflowY)) return p
  }
  return null
}

function observerFor(root: Element | null, rootMargin: string) {
  let byMargin = observers.get(root)
  if (!byMargin) observers.set(root, (byMargin = new Map()))
  let io = byMargin.get(rootMargin)
  if (!io) {
    io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) callbacks.get(entry.target)?.(entry)
      },
      { root, rootMargin },
    )
    byMargin.set(rootMargin, io)
  }
  return io
}

/** Calls `cb` whenever `el` enters/leaves its scroll container (expanded by `rootMargin`). Returns a stop function. */
export function observeInView(el: Element, rootMargin: string, cb: InViewCallback): () => void {
  const io = observerFor(scrollParent(el), rootMargin)
  callbacks.set(el, cb)
  io.observe(el)
  return () => {
    io.unobserve(el)
    callbacks.delete(el)
  }
}

/** Last measured rendered height (px) of each VirtualBlock, keyed by its cache key. */
export const virtualBlockHeights = new Map<string, number>()
