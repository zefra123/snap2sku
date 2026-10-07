export default defineNuxtConfig({
  devtools: { enabled: true },
  modules: ['@nuxt/fonts'],
  fonts: {
    families: [
      { name: 'Noto Serif SC', provider: 'google', weights: [600], display: 'swap', global: true },
      { name: 'JetBrains Mono', provider: 'google', weights: [400, 500, 600], display: 'swap', global: true },
    ],
  },
  css: ['~/assets/css/tokens.css'],
  runtimeConfig: {
    visionApiKey: '',
    visionModel: 'glm-4v-flash',
    visionBaseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    visionMock: process.env.NUXT_VISION_MOCK ?? '0',
    public: {
      visionMock: process.env.NUXT_VISION_MOCK === '1',
    },
  },
});
