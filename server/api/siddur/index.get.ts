const SIDDUR_TITLE = 'Weekday Siddur Chabad'

export default defineEventHandler(async () => {
  const index = await fetchSefariaIndex(SIDDUR_TITLE)
  const tree = buildToc(index.schema)

  return {
    title: index.title,
    // Skip the synthetic book-level root node; expose its children as the top-level TOC.
    sections: tree.children ?? [],
  }
})
