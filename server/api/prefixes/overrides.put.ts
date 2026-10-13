/** Set or clear (classification: null) a word's prefix override. Dev server only. */
export default defineEventHandler(async (event) => {
  if (!prefixOverridesEditable) {
    throw createError({ statusCode: 403, statusMessage: 'Prefix overrides can only be edited on the dev server' })
  }
  const body = await readBody<{ word?: unknown; classification?: unknown }>(event)
  const { word, classification } = body ?? {}
  if (typeof word !== 'string' || !word) {
    throw createError({ statusCode: 400, statusMessage: 'Missing "word"' })
  }
  if (classification !== null && !isPrefixClass(classification)) {
    throw createError({ statusCode: 400, statusMessage: '"classification" must be prefix, root, formative, or null' })
  }
  const overrides = await savePrefixOverride(word, classification)
  return { word, classification, total: Object.keys(overrides).length }
})
