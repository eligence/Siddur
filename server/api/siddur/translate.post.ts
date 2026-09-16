const SEFARIA_BASE = 'https://www.sefaria.org'

const VERSION_TITLE = 'Siddur Learning App Community'
const VERSION_SOURCE = 'https://github.com/EJayson/siddur'
const LANGUAGE = 'en'

interface TranslateBody {
  ref: string
  paragraphIndex: number
  translation: string
  /** Hash of the paragraph's English text as it was when the client loaded it,
   *  used for conflict detection. Empty string means "no existing translation". */
  expectedHash: string
}

/** Simple hash for conflict detection — not cryptographic, just a fingerprint. */
function hashText(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0
  }
  return String(h)
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const apiKey = config.sefariaApiKey

  if (!apiKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Translation submission is not configured. Set NUXT_SEFARIA_API_KEY on the server.',
    })
  }

  const body = await readBody<TranslateBody>(event)
  if (!body?.ref || body.paragraphIndex == null || !body.translation?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Missing ref, paragraphIndex, or translation.' })
  }

  const { ref, paragraphIndex, translation, expectedHash } = body
  const segmentRef = `${ref} ${paragraphIndex + 1}`

  // Conflict check: re-fetch the current version from Sefaria and compare.
  let currentText = ''
  try {
    const current = await $fetch<{ versions: { language: string; versionTitle: string; text: string[] }[] }>(
      `${SEFARIA_BASE}/api/v3/texts/${encodeURIComponent(ref)}`,
      { query: { version: `english|${VERSION_TITLE}` } },
    )
    const enVersion = current.versions?.find((v) => v.language === 'en')
    if (enVersion?.text) {
      currentText = enVersion.text[paragraphIndex] ?? ''
    }
  } catch {
    // Version doesn't exist yet — no conflict possible.
  }

  if (hashText(currentText) !== expectedHash) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict: this paragraph was modified on Sefaria since you loaded it. Please reload and re-draft.',
    })
  }

  // Try modify-bulk first (works if version already exists).
  const titleUnderscored = ref.split(',').slice(0, 1).join('').replace(/\s+/g, '_')
  const modifyBulkUrl = `${SEFARIA_BASE}/api/texts/modify-bulk/${titleUnderscored}`
  const payload = {
    versionTitle: VERSION_TITLE,
    language: LANGUAGE,
    text_map: { [segmentRef]: translation },
  }

  try {
    await $fetch(modifyBulkUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        apikey: apiKey,
        json: JSON.stringify(payload),
      }),
    })
    return { success: true, segmentRef }
  } catch (modifyErr: any) {
    // If modify-bulk fails because the version doesn't exist, try POST /api/texts/:ref
    // to create it with the full paragraph array (empty strings for unsubmitted paragraphs).
    const status = modifyErr?.statusCode ?? modifyErr?.response?.status
    if (status === 400 || status === 404) {
      // Fetch the Hebrew version to know how many paragraphs exist.
      const heData = await $fetch<{ versions: { language: string; text: string[] }[] }>(
        `${SEFARIA_BASE}/api/v3/texts/${encodeURIComponent(ref)}`,
        { query: { version: 'hebrew' } },
      )
      const heVersion = heData.versions?.find((v) => v.language === 'he')
      const paraCount = heVersion?.text?.length ?? paragraphIndex + 1
      const textArray = Array.from({ length: paraCount }, (_, i) =>
        i === paragraphIndex ? translation : '',
      )

      const createPayload = {
        versionTitle: VERSION_TITLE,
        versionSource: VERSION_SOURCE,
        language: LANGUAGE,
        text: textArray,
      }

      await $fetch(`${SEFARIA_BASE}/api/texts/${encodeURIComponent(ref)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          apikey: apiKey,
          json: JSON.stringify(createPayload),
        }),
      })
      return { success: true, segmentRef, created: true }
    }
    throw modifyErr
  }
})
