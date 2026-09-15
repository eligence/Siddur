export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const ref = query.ref

  if (!ref || typeof ref !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Missing required "ref" query param' })
  }

  return await fetchSefariaText(ref)
})
