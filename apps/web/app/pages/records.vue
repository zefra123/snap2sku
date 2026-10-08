<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  DescribeResultSchema,
  RECOGNIZE_FIELD_NAMES,
  RecognizeResultSchema,
  type ProductRecord,
  type RecognizeResult,
} from '@scope/shared/schema'

const records = ref<ProductRecord[]>([])
const loading = ref(true)
const errorMessage = ref('')
const expandedIds = ref(new Set<string>())
const descriptionOutputs = ref<Record<string, string>>({})
const descriptionErrors = ref<Record<string, string>>({})
const descriptionConfidences = ref<Record<string, number>>({})
const generatingIds = ref(new Set<string>())

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

async function generateDescription(record: ProductRecord): Promise<void> {
  descriptionOutputs.value = { ...descriptionOutputs.value, [record.id]: '' }
  descriptionErrors.value = { ...descriptionErrors.value, [record.id]: '' }
  const nextConfidences = { ...descriptionConfidences.value }
  delete nextConfidences[record.id]
  descriptionConfidences.value = nextConfidences
  generatingIds.value = new Set(generatingIds.value).add(record.id)
  let receivedDone = false
  let pendingConfidence: number | undefined

  try {
    const response = await fetch(`/api/records/${encodeURIComponent(record.id)}/describe`, {
      method: 'POST',
    })
    if (!response.ok) {
      descriptionErrors.value = {
        ...descriptionErrors.value,
        [record.id]: await responseErrorMessage(response),
      }
      return
    }
    if (!response.body) throw new Error('浏览器无法读取描述生成流')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (!receivedDone) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      buffer = await consumeDescriptionEvents(
        buffer,
        record.id,
        (doneEvent) => {
          receivedDone = doneEvent
        },
        (confidence) => {
          pendingConfidence = confidence
        },
      )
    }
    buffer += decoder.decode()
    if (buffer.trim()) {
      await consumeDescriptionEvents(
        `${buffer}\n\n`,
        record.id,
        (doneEvent) => {
          receivedDone = doneEvent
        },
        (confidence) => {
          pendingConfidence = confidence
        },
      )
    }

    if (!receivedDone) {
      descriptionErrors.value = {
        ...descriptionErrors.value,
        [record.id]: '描述未保存，请重新生成',
      }
    } else {
      record.descriptionAi = descriptionOutputs.value[record.id] ?? ''
      if (pendingConfidence !== undefined) {
        descriptionConfidences.value = {
          ...descriptionConfidences.value,
          [record.id]: pendingConfidence,
        }
      }
    }
  } catch {
    descriptionErrors.value = {
      ...descriptionErrors.value,
      [record.id]: '描述未保存，请重新生成',
    }
  } finally {
    const next = new Set(generatingIds.value)
    next.delete(record.id)
    generatingIds.value = next
  }
}

async function consumeDescriptionEvents(
  source: string,
  recordId: string,
  setDone: (done: boolean) => void,
  setConfidence: (confidence: number) => void,
): Promise<string> {
  let remainder = source.replaceAll('\r\n', '\n')
  let boundary = remainder.indexOf('\n\n')
  while (boundary !== -1) {
    const block = remainder.slice(0, boundary)
    remainder = remainder.slice(boundary + 2)
    const eventName = block.split('\n').find((line) => line.startsWith('event: '))?.slice(7)
    const data = block.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n')

    if (eventName === 'chunk') {
      const payload: unknown = JSON.parse(data)
      if (isDescriptionChunk(payload)) {
        descriptionOutputs.value = {
          ...descriptionOutputs.value,
          [recordId]: `${descriptionOutputs.value[recordId] ?? ''}${payload.text}`,
        }
      }
    } else if (eventName === 'error') {
      throw new Error(data)
    } else if (eventName === 'result') {
      const payload: unknown = JSON.parse(data)
      if (typeof payload === 'object' && payload !== null && 'confidence' in payload) {
        const parsed = DescribeResultSchema.shape.confidence.safeParse(payload.confidence)
        if (parsed.success) setConfidence(parsed.data.description)
      }
    } else if (eventName === 'done' && data === '[DONE]') {
      setDone(true)
    }

    boundary = remainder.indexOf('\n\n')
  }
  return remainder
}

function isDescriptionChunk(value: unknown): value is { text: string } {
  return typeof value === 'object' && value !== null && 'text' in value && typeof value.text === 'string'
}

function confidenceTickCount(confidence: number): number {
  return Math.max(1, Math.min(5, Math.round(confidence * 5)))
}

async function responseErrorMessage(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json()
    if (typeof payload === 'object' && payload !== null && 'data' in payload) {
      const data = payload.data
      if (typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string') {
        return data.message
      }
    }
  } catch {
    // 响应体不是 JSON 时使用状态码兜底。
  }
  if (response.status === 401) return '访问码缺失或不正确，请检查后重试。'
  if (response.status === 404) return '找不到这条商品记录，请刷新页面后重试。'
  return `描述生成失败（HTTP ${response.status}），请稍后重试。`
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
            <div class="ticket-description">
              <div class="ticket-description-heading"><strong>商品描述</strong><button class="describe-button" type="button" :disabled="generatingIds.has(record.id)" @click="generateDescription(record)">{{ generatingIds.has(record.id) ? '生成中…' : '生成描述' }}</button></div>
              <p>{{ (descriptionOutputs[record.id] ?? record.descriptionAi ?? record.description) || '未填写' }}<i v-if="generatingIds.has(record.id)" class="typing-caret" aria-label="正在生成" /></p>
              <div v-if="!generatingIds.has(record.id) && descriptionConfidences[record.id] !== undefined" class="description-confidence">
                <span>AI 描述置信度</span>
                <span class="confidence-scale" :class="{ 'confidence-scale--low': confidenceTickCount(descriptionConfidences[record.id]!) < 3 }" :aria-label="`置信度 ${confidenceTickCount(descriptionConfidences[record.id]!)} / 5`" role="img"><i v-for="tick in 5" :key="tick" :class="{ 'confidence-tick--filled': tick <= confidenceTickCount(descriptionConfidences[record.id]!) }" /></span>
                <b>{{ Math.round(descriptionConfidences[record.id]! * 100) }}%</b>
              </div>
              <span v-if="descriptionErrors[record.id]" class="description-error" role="alert">{{ descriptionErrors[record.id] }}</span>
            </div>
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
.ticket-description-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.ticket-description p { margin: 5px 0; white-space: pre-wrap; font-size: var(--font-xs); }
.describe-button { padding: 5px 9px; border: 1px solid var(--c-primary); background: transparent; color: var(--c-primary); font-size: var(--font-xs); cursor: pointer; }
.describe-button:disabled { opacity: .6; cursor: wait; }
.typing-caret { display: inline-block; width: 1px; height: 1em; margin-left: 2px; background: var(--c-primary); vertical-align: text-bottom; animation: typing-caret-blink 1s steps(2, start) infinite; }
.description-error { color: var(--c-error); font-size: var(--font-xs); }
.description-confidence { display: flex; align-items: center; gap: 7px; margin-top: 9px; color: var(--c-ink-2); font-size: var(--font-xs); }
.description-confidence b { color: var(--c-primary); font-family: var(--font-mono); font-size: var(--font-xs); font-variant-numeric: tabular-nums; }
.confidence-scale { display: inline-grid; grid-template-columns: repeat(5, 5px); gap: 2px; vertical-align: middle; }
.confidence-scale i { width: 5px; height: 7px; border: 1px solid var(--c-primary); background: transparent; }
.confidence-scale i.confidence-tick--filled { background: var(--c-primary); }
.confidence-scale--low { color: var(--c-warn-ink); }
.confidence-scale--low i { border-color: var(--c-warn-ink); }
.confidence-scale--low i.confidence-tick--filled { background: var(--c-warn-ink); }
@keyframes typing-caret-blink { to { visibility: hidden; } }
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
