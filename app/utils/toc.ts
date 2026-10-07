import type { TocNode } from '../../shared/types/siddur'

/** URL slug for a top-level TOC node's page (`/section/<slug>`). */
export function slugFor(key: string) {
  return key
    .toLowerCase()
    .replace(/[''"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Route path of a top-level TOC node's page. */
export function sectionPath(title: string) {
  return `/section/${slugFor(title)}`
}

/** Flatten the TOC tree into an ordered list of leaf (ref-bearing) entries. */
export function flattenLeaves(nodes: TocNode[]): TocNode[] {
  const out: TocNode[] = []
  for (const node of nodes) {
    if (node.children) out.push(...flattenLeaves(node.children))
    else out.push(node)
  }
  return out
}

/** DOM id for a leaf section's <section> element (also used as the URL hash). */
export function sectionElementId(ref: string) {
  return `section-${ref.replace(/[^a-zA-Z0-9]+/g, '-')}`
}

/** Walk the tree and return the top-level node whose subtree contains `ref`. */
export function findTopForLeaf(sections: TocNode[], ref: string): TocNode | undefined {
  for (const node of sections) {
    if (node.children?.length) {
      if (flattenLeaves(node.children).some((leaf) => leaf.ref === ref)) return node
    } else if (node.ref === ref) {
      return node
    }
  }
}
