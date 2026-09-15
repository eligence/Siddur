// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },
  routeRules: {
    '/': { prerender: true },
    '/api/siddur/**': { cache: { maxAge: 60 * 60 * 24 } },
  },
})
