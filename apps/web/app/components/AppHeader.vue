<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import {
  ACCESS_CODE_REQUIRED_EVENT,
  acknowledgeAccessCodeSaved,
  getAccessCode,
  setAccessCode,
} from "../utils/api";

withDefaults(defineProps<{ statusText?: string; badge?: string; costText?: string }>(), {
  statusText: '本地记录',
})

const accessCodeInput = ref("");
const accessCodePanelOpen = ref(false);
const missingCodeNoticeOpen = ref(false);
const accessCodeMessage = ref("");

function onAccessCodeRequired(): void {
  accessCodeInput.value = "";
  accessCodeMessage.value = "访问码缺失或不正确";
  accessCodePanelOpen.value = true;
  missingCodeNoticeOpen.value = true;
}

function openAccessCodePanel(): void {
  accessCodeInput.value = getAccessCode();
  accessCodeMessage.value = "";
  accessCodePanelOpen.value = true;
}

function saveAccessCode(): void {
  setAccessCode(accessCodeInput.value);
  accessCodeInput.value = getAccessCode();
  acknowledgeAccessCodeSaved();
  missingCodeNoticeOpen.value = !accessCodeInput.value;
  accessCodeMessage.value = accessCodeInput.value ? "访问码已保存" : "访问码已清除";
}

function dismissMissingCodeNotice(): void {
  missingCodeNoticeOpen.value = false;
  try {
    sessionStorage.setItem("snap2sku-access-code-notice-dismissed", "1");
  } catch {
    // Session storage can be unavailable in restricted browser contexts.
  }
}

onMounted(() => {
  accessCodeInput.value = getAccessCode();
  try {
    missingCodeNoticeOpen.value =
      !accessCodeInput.value &&
      sessionStorage.getItem("snap2sku-access-code-notice-dismissed") !== "1";
  } catch {
    missingCodeNoticeOpen.value = !accessCodeInput.value;
  }
  window.addEventListener(ACCESS_CODE_REQUIRED_EVENT, onAccessCodeRequired);
});

onUnmounted(() => {
  window.removeEventListener(ACCESS_CODE_REQUIRED_EVENT, onAccessCodeRequired);
});
</script>

<template>
  <header class="topbar">
    <NuxtLink class="brand" to="/" aria-label="snap2sku 首页">
      <span class="brand-mark">S</span>
      <span>snap<span class="brand-light">2</span>sku</span>
    </NuxtLink>
    <nav class="main-nav" aria-label="主导航">
      <NuxtLink to="/">录入工作台</NuxtLink>
      <NuxtLink to="/records">记录列表</NuxtLink>
    </nav>
    <div class="topbar-meta">
      <span v-if="costText" class="cost-counter">{{ costText }}</span>
      <span class="local-state"><span class="state-dot" />{{ statusText }}</span>
      <span v-if="badge" class="mode-badge">{{ badge }}</span>
      <button class="access-code-trigger" type="button" @click="openAccessCodePanel">
        访问码
      </button>
    </div>
  </header>
  <div v-if="missingCodeNoticeOpen" class="access-code-notice" role="status">
    <span>未设置访问码；生产环境下写操作会被拒绝</span>
    <button type="button" @click="openAccessCodePanel">设置访问码</button>
    <button
      class="notice-dismiss"
      type="button"
      aria-label="关闭提示"
      @click="dismissMissingCodeNotice"
    >
      ×
    </button>
  </div>
  <section
    v-if="accessCodePanelOpen"
    class="access-code-panel"
    aria-label="访问码设置"
  >
    <form @submit.prevent="saveAccessCode">
      <label for="web-access-code">访问码</label>
      <input
        id="web-access-code"
        v-model="accessCodeInput"
        type="password"
        autocomplete="off"
        placeholder="输入服务端配置的访问码"
      />
      <div class="access-code-actions">
        <button class="access-code-save" type="submit">保存</button>
        <button type="button" @click="accessCodePanelOpen = false">关闭</button>
        <button type="button" @click="accessCodeInput = ''; saveAccessCode()">
          清除
        </button>
      </div>
      <p v-if="accessCodeMessage" class="access-code-message" role="status">
        {{ accessCodeMessage }}
      </p>
    </form>
  </section>
</template>

<style>
.topbar { position: relative; z-index: 20; height: 48px; display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: center; padding: 0 clamp(20px, 4vw, 64px); background: var(--c-surface); border-bottom: 1px solid var(--c-border); }
.brand { display: inline-flex; align-items: center; gap: 9px; color: var(--c-ink); font-family: var(--font-heading); font-size: var(--font-lg); font-weight: 700; text-decoration: none; letter-spacing: -.4px; }
.brand-mark { width: 24px; height: 26px; display: grid; place-items: center; background: var(--c-primary); color: var(--c-surface); font-family: var(--font-mono); font-size: var(--font-xs); font-weight: 600; }
.brand-light { color: var(--c-accent); font-family: var(--font-mono); font-size: var(--font-sm); }
.main-nav { justify-self: center; display: flex; gap: 4px; }
.main-nav a { padding: 7px 10px; color: var(--c-ink-2); font-size: var(--font-xs); text-decoration: none; }
.main-nav a.router-link-active { color: var(--c-ink); background: var(--c-bg); }
.topbar-meta { justify-self: end; display: flex; align-items: center; gap: 14px; color: var(--c-ink-2); font-size: var(--font-xs); }
.cost-counter { color: var(--c-ink); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.local-state { display: inline-flex; align-items: center; }
.state-dot { display: inline-block; width: 6px; height: 6px; margin-right: 8px; border-radius: var(--radius-full); background: var(--c-success); vertical-align: 1px; }
.mode-badge { border: 1px solid var(--c-border); padding: 4px 7px; color: var(--c-primary); font-family: var(--font-mono); font-size: var(--font-xs); letter-spacing: .08em; }
.access-code-trigger,.access-code-notice button,.access-code-actions button { min-height: 30px; padding: 5px 9px; border: 1px solid var(--c-border); border-radius: var(--radius); background: var(--c-surface); color: var(--c-primary); font: inherit; cursor: pointer; }
.access-code-notice { display: flex; align-items: center; gap: 10px; padding: 8px clamp(20px, 4vw, 64px); background: var(--c-warn-bg); color: var(--c-warn-ink); font-size: var(--font-xs); }
.access-code-notice .notice-dismiss { margin-left: auto; min-width: 28px; padding: 0; color: var(--c-warn-ink); font-size: var(--font-base); }
.access-code-panel { position: absolute; z-index: 21; top: 54px; right: clamp(20px, 4vw, 64px); width: min(360px, calc(100vw - 32px)); padding: 14px; border: 1px solid var(--c-border); border-radius: var(--radius); background: var(--c-surface); box-shadow: var(--shadow-card); }
.access-code-panel form { display: grid; gap: 9px; }
.access-code-panel label { color: var(--c-ink); font-size: var(--font-xs); }
.access-code-panel input { min-width: 0; min-height: 36px; padding: 7px 9px; border: 1px solid var(--c-border); border-radius: var(--radius); background: var(--c-surface); color: var(--c-ink); font: inherit; }
.access-code-panel input:focus { border-color: var(--c-primary); outline: 2px solid color-mix(in oklch, var(--c-primary) 25%, transparent); }
.access-code-actions { display: flex; gap: 7px; }
.access-code-actions .access-code-save { border-color: var(--c-primary); background: var(--c-primary); color: var(--c-surface); }
.access-code-message { margin: 0; color: var(--c-ink-2); font-size: var(--font-xs); }
@media (max-width: 900px) {
  .topbar { grid-template-columns: 1fr auto; }
  .main-nav { justify-self: end; }
  .topbar-meta .local-state,.topbar-meta .mode-badge { display: none; }
}
@media (max-width: 600px) {
  .topbar { height: 48px; padding: 0 16px; }
  .topbar-meta { gap: 7px; }
  .cost-counter { display: none; }
  .access-code-notice { flex-wrap: wrap; padding-right: 16px; padding-left: 16px; }
  .access-code-panel { right: 12px; }
}
</style>
