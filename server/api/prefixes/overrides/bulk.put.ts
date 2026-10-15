export default defineEventHandler(async (event) => {
  if (!prefixOverridesEditable) {
    throw createError({ statusCode: 403, statusMessage: 'Prefix overrides can only be edited on the dev server' })
  }
  const body = await readBody<{ words?: unknown; classification?: unknown }>(event)
  const { words, classification } = body ?? {}
  if (!Array.isArray(words) || !words.length || words.some((word) => typeof word !== 'string' || !word)) {
    throw createError({ statusCode: 400, statusMessage: '"words" must be a non-empty array of strings' })
  }
  if (!isPrefixClass(classification)) {
    throw createError({ statusCode: 400, statusMessage: '"classification" must be prefix, root, or formative' })
  }
  const uniqueWords = [...new Set(words)] as string[]
  const overrides = await savePrefixOverrides(uniqueWords, classification)
  return { updated: uniqueWords.length, classification, total: Object.keys(overrides).length }
})
