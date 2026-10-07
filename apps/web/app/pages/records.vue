<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  RECOGNIZE_FIELD_NAMES,
  RecognizeResultSchema,
  type ProductRecord,
  type RecognizeResult,
} from '@scope/shared/schema'

const records = ref<ProductRecord[]>([])
const loading = ref(true)
const errorMessage = ref('')
const expandedIds = ref(new Set<string>())

onMounted(loadRecords)

async function loadRecords(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    records.value = await $fetch<ProductRecord[]>('/api/records')
  } catch {
    errorMessage.value = '记录暂时无法读取，请刷新页面重试。'
  } finally {
    loading.value = false
  }
}

function toggleRecord(id: string): void {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}

function elapsedMs(record: ProductRecord): number {
  return Math.max(0, record.durationMs.submittedAt - record.durationMs.uploadStart)
}

function formatDuration(record: ProductRecord): string {
  const seconds = Math.floor(elapsedMs(record) / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '未填写'
  if (Array.isArray(value)) return value.map(formatValue).join('、')
  if (typeof value === 'object') {
    if ('name' in value && typeof value.name === 'string') {
      return 'hex' in value && typeof value.hex === 'string' ? `${value.name} (${value.hex})` : value.name
    }
    return JSON.stringify(value)
  }
  return String(value)
}

function terminalFields(record: ProductRecord): Array<{ key: Exclude<keyof RecognizeResult, 'confidence'>; label: string; value: string }> {
  return RECOGNIZE_FIELD_NAMES
    .filter((field): field is Exclude<keyof RecognizeResult, 'confidence'> => field !== 'confidence')
    .map((key) => ({
      key,
      label: RecognizeResultSchema.shape[key].description ?? key,
      value: formatValue(record.recognize[key]),
    }))
}

function editLabel(field: string): string {
  const key = RECOGNIZE_FIELD_NAMES.find((candidate) => candidate === field)
  return key ? RecognizeResultSchema.shape[key].description ?? key : field
}

function editValue(value: unknown): string {
  return formatValue(value)
}
</script>

<template>
  <div class="records-page">
    <AppHeader status-text="本地记录" />

    <main class="records-main">
      <div class="records-page-heading">
        <div><span class="eyebrow">PRODUCT RECORDS · 02 / 03</span><h1>每一件，都有据可查。</h1><p>已确认的商品终值与人工修正记录。</p></div>
        <NuxtLink class="new-record-link" to="/">＋ 新建商品</NuxtLink>
      </div>

      <p v-if="errorMessage" class="records-alert" role="alert">{{ errorMessage }}</p>
      <div v-if="loading" class="records-state" role="status">正在读取本地记录…</div>
      <div v-else-if="!records.length" class="records-state records-state--empty">
        <span class="empty-mark">▤</span><strong>还没有商品记录</strong><span>完成一件商品录入后，记录会显示在这里。</span><NuxtLink to="/">前往录入工作台 →</NuxtLink>
      </div>

      <section v-else class="records-table-wrap" aria-label="商品记录列表">
        <div class="records-table-head" role="row">
          <span>照片</span><span>商品 / 品类 · 颜色</span><span>SKU 数</span><span>耗时</span><span>成本</span><span>人工修正</span>
        </div>
        <div v-for="record in records" :key="record.id" class="record-group">
          <button class="record-list-row" type="button" :aria-expanded="expandedIds.has(record.id)" @click="toggleRecord(record.id)">
            <span class="record-thumbnail"><img v-if="record.images[0]" :src="`/api/uploads/${record.images[0]}`" alt="商品缩略图"><span v-else>—</span></span>
            <span class="record-product"><strong>{{ record.recognize.item_name }}</strong><small>{{ record.recognize.category }} · {{ record.recognize.colors.map((color) => color.name).join(' / ') }}</small></span>
            <span class="record-metric">{{ record.sku.length }}</span>
            <span class="record-metric">{{ formatDuration(record) }}</span>
            <span class="record-metric">¥{{ record.costEstimate.toFixed(3) }}</span>
            <span class="record-edit-count">{{ record.edits.length ? `${record.edits.length} 项已改` : '无修改' }}</span>
          </button>
          <section v-if="expandedIds.has(record.id)" class="record-ticket" aria-label="已确认的商品终值">
            <div class="ticket-heading"><span>FINAL PRODUCT VALUES</span><b>已确认为人工终值</b></div>
            <dl class="terminal-fields"><div v-for="field in terminalFields(record)" :key="field.key"><dt>{{ field.label }}</dt><dd>{{ field.value }}</dd></div></dl>
            <div class="ticket-description"><strong>商品描述</strong><p>{{ record.description || '未填写' }}</p></div>
            <div class="ticket-skus"><strong>SKU 规格</strong><span>{{ record.sku.map((sku) => `${sku.color} / ${sku.size}：库存 ${sku.stock}，吊牌价 ¥${sku.tagPrice}，批发价 ¥${sku.wholesalePrice}`).join('；') }}</span></div>
            <div v-if="record.edits.length" class="edits-flow">
              <strong>人工修正流水</strong>
              <div v-for="(edit, index) in record.edits" :key="`${record.id}-${edit.field}-${index}`" class="edit-flow-row"><span>{{ editLabel(edit.field) }}</span><code>{{ editValue(edit.from) }} → {{ editValue(edit.to) }}</code></div>
            </div>
            <p v-else class="no-edits">无人工修正。</p>
          </section>
        </div>
      </section>

      <footer class="records-footer"><span>snap2sku · 本地演示数据</span><NuxtLink to="/">返回录入工作台</NuxtLink></footer>
    </main>
  </div>
</template>

<style>
.records-page { min-height: 100vh; }
.records-main { width: min(1160px, calc(100% - 64px)); margin: 0 auto; }
.records-page-heading { display: flex; justify-content: space-between; align-items: end; gap: 20px; padding: 38px 0 26px; }
.records-page-heading .eyebrow { color: var(--c-ink-2); font-family: var(--font-mono); font-size: var(--font-xs); letter-spacing: .1em; }
.records-page-heading h1 { margin: 12px 0 6px; font-family: var(--font-heading); font-size: var(--font-xl); font-weight: 600; }
.records-page-heading p { margin: 0; color: var(--c-ink-2); font-size: var(--font-sm); }
.new-record-link { padding: 9px 12px; border: 1px solid var(--c-primary); color: var(--c-primary); font-size: var(--font-xs); text-decoration: none; white-space: nowrap; }
.records-table-wrap { border: 1px solid var(--c-border); background: var(--c-surface); }
.records-table-head,.record-list-row { display: grid; grid-template-columns: 52px minmax(180px, 1fr) 72px 92px 96px 92px; align-items: center; gap: 12px; }
.records-table-head { min-height: 38px; padding: 0 14px; background: var(--c-bg); color: var(--c-ink-2); font-family: var(--font-mono); font-size: var(--font-xs); }
.record-group { border-top: 1px solid var(--c-border); }
.record-list-row { width: 100%; min-height: 68px; padding: 8px 14px; border: 0; background: transparent; text-align: left; cursor: pointer; }
.record-list-row:hover,.record-list-row[aria-expanded="true"] { background: color-mix(in oklch, var(--c-bg) 55%, var(--c-surface)); }
.record-thumbnail { width: 44px; height: 48px; display: grid; place-items: center; overflow: hidden; border: 1px solid var(--c-border); background: var(--c-bg); color: var(--c-ink-2); }
.record-thumbnail img { width: 100%; height: 100%; object-fit: cover; }
.record-product { min-width: 0; display: grid; gap: 5px; }
.record-product strong { overflow: hidden; font-size: var(--font-sm); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.record-product small { color: var(--c-ink-2); font-size: var(--font-xs); }
.record-metric { color: var(--c-ink); font-family: var(--font-mono); font-size: var(--font-xs); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
.record-edit-count { color: var(--c-ink-2); font-size: var(--font-xs); text-align: right; white-space: nowrap; }
.record-ticket { margin: 0 14px 14px; padding: 16px; border: 1px solid var(--c-border); border-radius: var(--radius-tag); background: var(--c-surface); }
.ticket-heading { display: flex; justify-content: space-between; gap: 12px; padding-bottom: 11px; border-bottom: 1px solid var(--c-border); color: var(--c-ink-2); font-family: var(--font-mono); font-size: var(--font-xs); }
.ticket-heading b { color: var(--c-success); font-family: var(--font-body); font-weight: 500; }
.terminal-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 18px; margin: 14px 0; }
.terminal-fields div { min-width: 0; }
.terminal-fields dt,.ticket-description strong,.ticket-skus strong,.edits-flow > strong { margin-bottom: 4px; color: var(--c-ink-2); font-size: var(--font-xs); }
.terminal-fields dd { margin: 0; font-size: var(--font-sm); overflow-wrap: anywhere; }
.ticket-description,.ticket-skus { padding-top: 10px; border-top: 1px solid var(--c-border); }
.ticket-description p { margin: 5px 0; white-space: pre-wrap; font-size: var(--font-xs); }
.ticket-skus { display: grid; gap: 5px; font-size: var(--font-xs); }
.edits-flow { display: grid; gap: 7px; margin-top: 12px; }
.edit-flow-row { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 12px; align-items: baseline; font-size: var(--font-xs); }
.edit-flow-row code { color: var(--c-ink); font-family: var(--font-mono); font-size: var(--font-xs); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.no-edits { margin: 12px 0 0; color: var(--c-ink-2); font-size: var(--font-xs); }
.records-state { display: flex; justify-content: center; align-items: center; min-height: 180px; border: 1px dashed var(--c-border); color: var(--c-ink-2); font-size: var(--font-sm); }
.records-state--empty { flex-direction: column; gap: 9px; }
.records-state--empty strong { color: var(--c-ink); font-family: var(--font-heading); font-size: var(--font-lg); }
.records-state--empty a,.records-footer a { color: var(--c-primary); font-size: var(--font-xs); text-decoration: none; }
.empty-mark { color: var(--c-primary); font-size: 22px; }
.records-alert { padding: 10px 12px; border-left: 2px solid var(--c-error); background: var(--c-surface); color: var(--c-error); font-size: var(--font-xs); }
.records-footer { display: flex; justify-content: space-between; padding: 18px 0; color: var(--c-ink-2); font-family: var(--font-mono); font-size: var(--font-xs); }
@media (max-width: 760px) {
  .records-main { width: calc(100% - 28px); }
  .records-table-head { display: none; }
  .record-list-row { grid-template-columns: 46px minmax(0, 1fr) 58px; gap: 8px; }
  .record-metric:nth-of-type(4),.record-metric:nth-of-type(5) { grid-column: 2; justify-self: start; }
  .record-edit-count { grid-column: 3; grid-row: 2; }
  .terminal-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
