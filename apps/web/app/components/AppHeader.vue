<script setup lang="ts">
withDefaults(defineProps<{ statusText?: string; badge?: string }>(), {
  statusText: '本地记录',
})
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
      <span class="local-state"><span class="state-dot" />{{ statusText }}</span>
      <span v-if="badge" class="mode-badge">{{ badge }}</span>
    </div>
  </header>
</template>

<style>
.topbar { height: 48px; display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: center; padding: 0 clamp(20px, 4vw, 64px); background: var(--c-surface); border-bottom: 1px solid var(--c-border); }
.brand { display: inline-flex; align-items: center; gap: 9px; color: var(--c-ink); font-family: var(--font-heading); font-size: var(--font-lg); font-weight: 700; text-decoration: none; letter-spacing: -.4px; }
.brand-mark { width: 24px; height: 26px; display: grid; place-items: center; background: var(--c-primary); color: var(--c-surface); font-family: var(--font-mono); font-size: var(--font-xs); font-weight: 600; }
.brand-light { color: var(--c-accent); font-family: var(--font-mono); font-size: var(--font-sm); }
.main-nav { justify-self: center; display: flex; gap: 4px; }
.main-nav a { padding: 7px 10px; color: var(--c-ink-2); font-size: var(--font-xs); text-decoration: none; }
.main-nav a.router-link-active { color: var(--c-ink); background: var(--c-bg); }
.topbar-meta { justify-self: end; display: flex; align-items: center; gap: 14px; color: var(--c-ink-2); font-size: var(--font-xs); }
.local-state { display: inline-flex; align-items: center; }
.state-dot { display: inline-block; width: 6px; height: 6px; margin-right: 8px; border-radius: var(--radius-full); background: var(--c-success); vertical-align: 1px; }
.mode-badge { border: 1px solid var(--c-border); padding: 4px 7px; color: var(--c-primary); font-family: var(--font-mono); font-size: var(--font-xs); letter-spacing: .08em; }
@media (max-width: 900px) {
  .topbar { grid-template-columns: 1fr auto; }
  .main-nav { justify-self: end; }
}
@media (max-width: 600px) {
  .topbar { height: 48px; padding: 0 16px; }
}
</style>
