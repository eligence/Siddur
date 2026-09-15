// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },
  routeRules: {
    '/': { prerender: true },
    // Sefaria data is already cached (and invalidatable) via useStorage in
    // server/utils/sefaria.ts. Avoid a route-level HTTP cache here since it sets
    // Cache-Control on the response, which the *browser* also honors — masking
    // any server-side data/logic fixes behind a stale client-side cache.
  },
})
