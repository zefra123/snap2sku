import vueDevTools from "vite-plugin-vue-devtools";

export default defineNuxtConfig({
  devtools: { enabled: true },
  vite: {
    plugins: [vueDevTools()],
  },
  modules: ["@nuxt/fonts"],
  fonts: {
    families: [
      {
        name: "Noto Serif SC",
        provider: "google",
        weights: [600],
        display: "swap",
        global: true,
      },
      {
        name: "JetBrains Mono",
        provider: "google",
        weights: [400, 500, 600],
        display: "swap",
        global: true,
      },
    ],
  },
  css: ["~/assets/css/tokens.css"],
  runtimeConfig: {
    dataDir: "",
    accessCode: "",
    uploadSigningSecret: "",
    uploadSigningSecretPrevious: "",
    visionApiKey: "",
    visionModel: "glm-4v-flash",
    visionBaseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    visionInputPricePerMillion: 0,
    visionOutputPricePerMillion: 0,
    // 仅允许运行时注入；此处读取 process.env 会把 Mock 开关烤进构建产物。
    visionMock: "",
    trialBudgetCny: 200,
    trialReserveCny: "",
    trialId: "",
    public: {
      visionMock: false,
    },
  },
});
