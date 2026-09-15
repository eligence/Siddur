export default defineEventHandler(async (event) => {
  const word = getRouterParam(event, 'word')
  if (!word) {
    throw createError({ statusCode: 400, statusMessage: 'Missing required "word" route param' })
  }

  return await fetchLexiconEntry(word)
})
