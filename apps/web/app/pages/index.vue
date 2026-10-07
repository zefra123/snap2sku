<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  AUDIENCES,
  CATEGORIES,
  ProductRecordSchema,
  RECOGNIZE_FIELD_NAMES,
  RecognizeResultSchema,
  SEASONS,
  SIZES_TOP,
  STYLES,
  type ProductRecord,
  type RecognizeResult,
  type SKUItem,
  type UploadFile,
} from '@scope/shared/schema'

interface QueuedImage {
  key: string
  file: File
  previewUrl: string
  originalSize: number
  compressedBlob?: Blob
  compressedSize?: number
  uploaded?: UploadFile
  status: 'ready' | 'uploading' | 'uploaded' | 'error'
  error?: string
}

interface FieldEdit {
  field: string
  from: unknown
  to: unknown
  isCorrection: boolean
}

const config = useRuntimeConfig()
const mockEnabled = computed(() => config.public.visionMock)
const mockFixture = ref<'tagPrice' | 'noTagPrice'>('tagPrice')
const fileInput = ref<HTMLInputElement>()
const imageQueue = ref<QueuedImage[]>([])
const customColor = reactive({ name: '', hex: '#B6A895' })
const result = ref<RecognizeResult>()
const initialResult = ref<RecognizeResult>()
const recognizedFileId = ref<string>()
const confirmedFields = reactive(new Set<string>())
const edits = ref<Record<string, FieldEdit>>({})
const aiCorrect = ref<Record<string, boolean>>({})
const sizeSelection = ref<string[]>(['S', 'M', 'L'])
const sizeToAdd = ref<string>('XL')
const skuValues = reactive<Record<string, { stock: number; tagPrice: number | null; wholesalePrice: number | null }>>({})
const description = ref('')
const recordList = ref<ProductRecord[]>([])
const uploadStart = ref<number>()
const recognizedAt = ref<number>()
const busy = ref(false)
const recognizing = ref(false)
const saving = ref(false)
const statusMessage = ref('')
const errorMessage = ref('')
const dragActive = ref(false)
const selectedImageIndex = ref(0)

const colorChoices = [
  { name: '藏青', hex: '#263A55' }, { name: '米白', hex: '#E8E0D0' },
  { name: '黑色', hex: '#383633' }, { name: '灰色', hex: '#85827B' },
  { name: '奶油黄', hex: '#E9D9A6' }, { name: '酒红', hex: '#783E43' },
]
const availableColors = computed(() => colorChoices.filter((color) => !result.value?.colors.some((item) => item.name === color.name)))

const skuCells = computed(() => {
  if (!result.value) return []
  return result.value.colors.flatMap((color) => sizeSelection.value.map((size) => ({
    key: skuKey(color.name, size),
    color: color.name,
    hex: color.hex,
    size,
  })))
})
const validSku = computed<SKUItem[]>(() => skuCells.value.flatMap((cell) => {
  const value = skuValues[cell.key]
  if (!value || value.tagPrice === null || value.wholesalePrice === null || value.tagPrice <= 0 || value.wholesalePrice <= 0) return []
  return [{ color: cell.color, size: cell.size, stock: value.stock, tagPrice: value.tagPrice, wholesalePrice: value.wholesalePrice }]
}))
const readySkuCount = computed(() => validSku.value.length)
const uploadComplete = computed(() => imageQueue.value.length > 0 && imageQueue.value.every((image) => image.uploaded))
const editedFieldCount = computed(() => Object.keys(edits.value).length)

function skuKey(color: string, size: string): string {
  return `${color}::${size}`
}

function fieldLabel(field: keyof RecognizeResult): string {
  return RecognizeResultSchema.shape[field].description ?? field
}

function setTagPrice(event: Event): void {
  if (!result.value) return
  const text = (event.target as HTMLInputElement).value
  result.value.tagPrice = text === '' ? null : Number(text)
  recordFieldChange('tagPrice')
}

function setSkuValue(key: string, field: 'stock' | 'tagPrice' | 'wholesalePrice', event: Event): void {
  const text = (event.target as HTMLInputElement).value
  const parsed = text === '' ? null : Number(text)
  const value = skuValues[key]
  if (!value) return
  if (field === 'stock') value.stock = parsed === null ? 0 : Math.max(0, Math.floor(parsed))
  else value[field] = parsed
}

function skuValue(key: string): { stock: number; tagPrice: number | null; wholesalePrice: number | null } {
  const existing = skuValues[key]
  if (existing) return existing
  const fallback = { stock: 0, tagPrice: result.value?.tagPrice ?? null, wholesalePrice: null }
  skuValues[key] = fallback
  return fallback
}

function loadExample(): void {
  const example = RecognizeResultSchema.parse({
    category: '上衣',
    colors: [{ name: '奶油黄', hex: '#E9D9A6' }],
    style: '休闲',
    seasons: ['春', '夏'],
    audience: '中性',
    fabric: '棉混纺',
    tagPrice: 129,
    item_name: '奶油黄宽松短袖上衣',
    confidence: { category: 0.92, colors: 0.84, style: 0.88, overall: 0.86 },
  })
  result.value = example
  initialResult.value = structuredClone(example)
  confirmedFields.clear()
  edits.value = {}
  aiCorrect.value = {}
  description.value = ''
  sizeSelection.value = ['S', 'M', 'L']
  for (const [index, size] of sizeSelection.value.entries()) {
    skuValues[skuKey('奶油黄', size)] = { stock: index === 0 ? 0 : 12 + index, tagPrice: 129, wholesalePrice: 58 }
  }
  recognizedFileId.value = undefined
  statusMessage.value = '示例资料已填入；此操作没有上传图片，也没有请求模型。'
  errorMessage.value = ''
}

function removeSelectedImage(): void {
  const image = imageQueue.value[selectedImageIndex.value]
  if (image) removeImage(image.key)
}

function handleFileChange(event: Event): void {
  const target = event.target
  if (target instanceof HTMLInputElement && target.files) void selectFiles(target.files)
}

function prettySize(bytes: number | undefined): string {
  if (bytes === undefined) return '—'
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function fieldConfidence(field: string): number {
  const confidence = result.value?.confidence
  if (!confidence) return 1
  if (field === 'category' || field === 'colors' || field === 'style') return confidence[field]
  return confidence.overall
}

function confidenceTickCount(field: string): number {
  return Math.max(1, Math.min(5, Math.round(fieldConfidence(field) * 5)))
}

function fieldClass(field: string): string[] {
  const classes = ['field-card']
  classes.push(confirmedFields.has(field) ? 'field-card--confirmed' : 'field-card--suggested')
  if (fieldConfidence(field) < 0.7) classes.push('field-card--low')
  return classes
}

function recordFieldChange(field: keyof RecognizeResult): void {
  if (!result.value || !initialResult.value) return
  confirmedFields.add(field)
  const from = initialResult.value[field]
  const to = result.value[field]
  const isChanged = JSON.stringify(from) !== JSON.stringify(to)
  if (isChanged) {
    edits.value[field] = { field, from, to: structuredClone(to), isCorrection: true }
    aiCorrect.value[field] = false
  } else {
    delete edits.value[field]
    aiCorrect.value[field] = true
  }
}

function markCorrect(field: keyof RecognizeResult): void {
  confirmedFields.add(field)
  aiCorrect.value[field] = true
  delete edits.value[field]
}

function toggleSeason(season: typeof SEASONS[number]): void {
  if (!result.value) return
  if (result.value.seasons.includes(season) && result.value.seasons.length === 1) return
  result.value.seasons = result.value.seasons.includes(season)
    ? result.value.seasons.filter((item) => item !== season)
    : [...result.value.seasons, season]
  recordFieldChange('seasons')
}

function toggleColor(color: typeof colorChoices[number]): void {
  if (!result.value) return
  const exists = result.value.colors.some((item) => item.name === color.name)
  if (exists) {
    if (result.value.colors.length === 1) return
    result.value.colors = result.value.colors.filter((item) => item.name !== color.name)
  } else if (result.value.colors.length < 4) {
    result.value.colors = [...result.value.colors, color]
  }
  recordFieldChange('colors')
}

function addCustomColor(): void {
  if (!result.value || result.value.colors.length >= 4) return
  const name = customColor.name.trim()
  if (!name || !/^#[0-9a-fA-F]{6}$/.test(customColor.hex)) {
    errorMessage.value = '请填写颜色名称和 #RRGGBB 格式色值。'
    return
  }
  if (result.value.colors.some((color) => color.name === name)) {
    errorMessage.value = '这个颜色已在商品资料中。'
    return
  }
  result.value.colors = [...result.value.colors, { name, hex: customColor.hex.toUpperCase() }]
  customColor.name = ''
  recordFieldChange('colors')
}

watch(skuCells, (cells) => {
  for (const cell of cells) {
    if (!skuValues[cell.key]) {
      skuValues[cell.key] = { stock: 0, tagPrice: result.value?.tagPrice ?? null, wholesalePrice: null }
    }
  }
}, { immediate: true })

async function selectFiles(files: FileList | File[]): Promise<void> {
  errorMessage.value = ''
  statusMessage.value = ''
  const remaining = Math.max(0, 10 - imageQueue.value.length)
  const selectedFiles = Array.from(files).slice(0, remaining)
  if (selectedFiles.length < files.length) errorMessage.value = '最多可添加 10 张图片，超出的图片未加入队列。'
  const added = await Promise.all(selectedFiles.map(async (file): Promise<QueuedImage | undefined> => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      errorMessage.value = '不支持该格式，请使用 JPG、PNG 或 WebP 图片。'
      return undefined
    }
    try {
      const compressedBlob = await compressImage(file)
      return {
        key: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(compressedBlob),
        originalSize: file.size,
        compressedBlob,
        compressedSize: compressedBlob.size,
        status: 'ready',
      }
    } catch {
      errorMessage.value = `无法读取图片「${file.name}」，请换一张 JPG、PNG 或 WebP。`
      return undefined
    }
  }))
  const validAdded = added.filter((item): item is QueuedImage => item !== undefined)
  imageQueue.value = [...imageQueue.value, ...validAdded]
  if (validAdded.length) {
    result.value = undefined
    initialResult.value = undefined
    recognizedFileId.value = undefined
  }
  if (fileInput.value) fileInput.value.value = ''
}

async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const ratio = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio))
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas unavailable')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片压缩失败')), 'image/jpeg', 0.85)
  })
}

function removeImage(key: string): void {
  const image = imageQueue.value.find((item) => item.key === key)
  if (image) URL.revokeObjectURL(image.previewUrl)
  imageQueue.value = imageQueue.value.filter((item) => item.key !== key)
  selectedImageIndex.value = Math.min(selectedImageIndex.value, Math.max(0, imageQueue.value.length - 1))
  if (image?.uploaded?.fileId === recognizedFileId.value) {
    result.value = undefined
    initialResult.value = undefined
    recognizedFileId.value = undefined
  }
}

async function uploadImages(): Promise<void> {
  if (!imageQueue.value.length) {
    errorMessage.value = '先添加至少一张商品图片。'
    return
  }
  busy.value = true
  errorMessage.value = ''
  statusMessage.value = '正在上传压缩图片…'
  uploadStart.value ??= Date.now()
  try {
    for (const image of imageQueue.value) {
      if (image.uploaded) continue
      image.status = 'uploading'
      const formData = new FormData()
      const blob = image.compressedBlob
      if (!blob) throw new Error('图片压缩数据不存在')
      formData.append('image', blob, image.file.name.replace(/\.[^.]+$/, '.jpg'))
      formData.append('originalSize', String(image.originalSize))
      image.uploaded = await $fetch<UploadFile>('/api/upload', { method: 'POST', body: formData })
      image.status = 'uploaded'
    }
    statusMessage.value = '图片已上传，可以开始识别。'
  } catch (error) {
    const failedImage = imageQueue.value.find((image) => !image.uploaded)
    if (failedImage) failedImage.status = 'error'
    errorMessage.value = readErrorMessage(error)
    statusMessage.value = ''
  } finally {
    busy.value = false
  }
}

async function recognize(): Promise<void> {
  if (!imageQueue.value.length) {
    errorMessage.value = '先添加至少一张商品图片。'
    return
  }
  if (!uploadComplete.value) await uploadImages()
  if (!uploadComplete.value) return
  const firstImage = imageQueue.value[selectedImageIndex.value]
  if (!firstImage?.uploaded) return
  busy.value = true
  recognizing.value = true
  errorMessage.value = ''
  statusMessage.value = '正在识别商品信息…'
  try {
    const recognized = await $fetch<RecognizeResult>('/api/recognize', {
      method: 'POST',
      body: { fileId: firstImage.uploaded.fileId, mockFixture: mockFixture.value },
    })
    result.value = RecognizeResultSchema.parse(recognized)
    initialResult.value = structuredClone(result.value)
    recognizedFileId.value = firstImage.uploaded.fileId
    confirmedFields.clear()
    edits.value = {}
    aiCorrect.value = {}
    description.value = ''
    recognizedAt.value = Date.now()
    for (const cellColor of result.value.colors) {
      for (const size of sizeSelection.value) {
        const key = skuKey(cellColor.name, size)
        skuValues[key] ??= { stock: 0, tagPrice: result.value.tagPrice, wholesalePrice: null }
        skuValues[key].tagPrice = result.value.tagPrice
      }
    }
    statusMessage.value = `识别完成。当前使用${mockEnabled.value ? '本地 Mock 数据' : '视觉模型'}。`
  } catch (error) {
    statusMessage.value = ''
    errorMessage.value = readErrorMessage(error)
  } finally {
    recognizing.value = false
    busy.value = false
  }
}

function addSize(): void {
  if (!sizeSelection.value.includes(sizeToAdd.value)) sizeSelection.value = [...sizeSelection.value, sizeToAdd.value]
  const remaining = SIZES_TOP.filter((size) => !sizeSelection.value.includes(size))
  sizeToAdd.value = remaining[0] ?? SIZES_TOP[0]
}

function removeSize(size: string): void {
  if (sizeSelection.value.length <= 1) return
  sizeSelection.value = sizeSelection.value.filter((item) => item !== size)
}

async function refreshRecords(): Promise<void> {
  try {
    recordList.value = await $fetch<ProductRecord[]>('/api/records')
  } catch {
    recordList.value = []
  }
}

async function submitRecord(): Promise<void> {
  if (!result.value) {
    errorMessage.value = '请先识别商品并确认表单。'
    return
  }
  if (!imageQueue.value.length) {
    errorMessage.value = '示例资料仅供预览；保存前请上传商品图片并完成识别。'
    return
  }
  if (!imageQueue.value.every((image) => image.uploaded)) {
    errorMessage.value = '请先完成图片上传。'
    return
  }
  if (validSku.value.length !== skuCells.value.length || skuCells.value.length === 0) {
    errorMessage.value = '请为每个颜色和尺码填写大于 0 的吊牌价与批发单价。'
    return
  }

  saving.value = true
  errorMessage.value = ''
  try {
    const now = Date.now()
    const draft = {
      id: crypto.randomUUID(),
      createdAt: new Date(now).toISOString(),
      durationMs: { uploadStart: uploadStart.value ?? now, recognizedAt: recognizedAt.value ?? now, submittedAt: now },
      images: imageQueue.value.flatMap((image) => image.uploaded ? [image.uploaded.fileId] : []),
      recognize: result.value,
      edits: Object.values(edits.value),
      sku: validSku.value,
      description: description.value,
      aiCorrect: aiCorrect.value,
      costEstimate: 0,
    }
    const record = ProductRecordSchema.parse(draft)
    const saved = await $fetch<ProductRecord>('/api/records', { method: 'POST', body: record })
    recordList.value = [saved, ...recordList.value]
    statusMessage.value = '商品记录已保存。'
  } catch (error) {
    errorMessage.value = readErrorMessage(error)
  } finally {
    saving.value = false
  }
}

function readErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const data = 'data' in error ? error.data : undefined
    if (typeof data === 'object' && data !== null && 'data' in data) {
      const details = data.data
      if (typeof details === 'object' && details !== null && 'message' in details && typeof details.message === 'string') return details.message
    }
    if (typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string') return data.message
    if (typeof data === 'object' && data !== null && 'statusMessage' in data && typeof data.statusMessage === 'string') return data.statusMessage
    if ('statusMessage' in error && typeof error.statusMessage === 'string') return error.statusMessage
    if ('message' in error && typeof error.message === 'string') return error.message
  }
  return '操作没有完成，请保留表单内容后重试。'
}

onMounted(() => void refreshRecords())
onBeforeUnmount(() => imageQueue.value.forEach((image) => URL.revokeObjectURL(image.previewUrl)))
</script>

<template>
  <div class="app-shell">
    <AppHeader status-text="本地记录" :badge="mockEnabled ? 'MOCK 模式' : undefined" />

    <main id="top" class="workspace">
      <section class="page-heading">
        <div>
          <div class="eyebrow">PRODUCT INTAKE <span>·</span> 01 / 03</div>
          <h1>把新品，<em>录得更快。</em></h1>
          <p>上传一张商品图，AI 帮你整理商品资料与 SKU。</p>
        </div>
        <div class="heading-note"><span class="note-icon">↗</span><span>建议使用光线充足、<br>能看清吊牌的照片</span></div>
      </section>

      <div v-if="errorMessage" class="notice notice--error" role="alert"><span>!</span>{{ errorMessage }}</div>
      <div v-if="statusMessage" class="notice notice--success" role="status"><span>✓</span>{{ statusMessage }}</div>

      <div class="work-grid">
        <aside class="upload-column">
          <section class="panel upload-panel">
            <div class="panel-heading">
              <div><span class="section-index">01</span><h2>商品照片</h2></div>
              <span class="small-count">{{ imageQueue.length }} / 10</span>
            </div>

            <div
              class="dropzone"
              :class="{ 'dropzone--active': dragActive, 'dropzone--has-images': imageQueue.length }"
              @dragover.prevent="dragActive = true"
              @dragleave.prevent="dragActive = false"
              @drop.prevent="dragActive = false; selectFiles($event.dataTransfer?.files ?? [])"
            >
              <template v-if="!imageQueue.length">
                <div class="upload-illustration"><span class="hanger-line" /><span class="hanger-hook">⌁</span><span class="hanger-shape">⌑</span><i>+</i></div>
                <strong>把到货的照片拖进来</strong>
                <span class="drop-hint">或点击下方按钮选择图片</span>
                <span class="file-rules">JPG / PNG / WebP <b>·</b> 单张 ≤ 5 MB</span>
                <button class="example-button" type="button" @click="loadExample">先看示例</button>
              </template>
              <template v-else>
                <div class="preview-stage">
                  <img :src="imageQueue[selectedImageIndex]?.previewUrl" alt="当前选中的商品照片预览">
                  <span class="preview-tag">{{ imageQueue[selectedImageIndex]?.uploaded ? '已上传' : '待上传' }}</span>
                  <button class="preview-remove" type="button" aria-label="移除当前图片" @click="removeSelectedImage">×</button>
                </div>
                <div class="image-strip" aria-label="已选择图片">
                  <button
                    v-for="(image, index) in imageQueue"
                    :key="image.key"
                    type="button"
                    class="thumb"
                    :class="{ 'thumb--selected': selectedImageIndex === index, 'thumb--recognizing': recognizing && selectedImageIndex === index }"
                    :aria-label="`选择第 ${index + 1} 张图片`"
                    @click="selectedImageIndex = index"
                  ><img :src="image.previewUrl" alt=""><i v-if="image.uploaded">✓</i></button>
                  <button class="thumb thumb--add" type="button" aria-label="再添加图片" @click="fileInput?.click()">+</button>
                </div>
                <span class="file-rules">多图已就绪 · 当前识别第 {{ selectedImageIndex + 1 }} 张</span>
              </template>
            </div>

            <input ref="fileInput" class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple @change="handleFileChange">
            <button class="button button--outline choose-button" type="button" @click="fileInput?.click()">选择商品图片 <span>＋</span></button>

            <div v-if="imageQueue.length" class="compression-list">
              <div v-for="image in imageQueue" :key="image.key" class="compression-row">
                <span class="compression-status" :class="`compression-status--${image.status}`">{{ image.status === 'uploaded' ? '✓' : image.status === 'error' ? '!' : '·' }}</span>
                <span class="compression-name" :title="image.file.name">{{ image.file.name }}</span>
                <span class="compression-size">{{ prettySize(image.originalSize) }} <i>→</i> {{ prettySize(image.compressedSize) }}</span>
                <button type="button" class="row-remove" aria-label="移除图片" @click="removeImage(image.key)">×</button>
              </div>
            </div>

            <div class="upload-footnote"><span class="lock-mark">◈</span> 图片仅用于本次识别与商品记录</div>
          </section>

          <section class="guide-card">
            <div class="guide-stamp">TIP<br><small>01</small></div>
            <div><strong>拍摄小贴士</strong><p>商品正面、细节和吊牌分开拍，识别更准确。模糊或遮挡的字段会提示你确认。</p></div>
          </section>
        </aside>

        <section class="details-column">
          <section class="panel recognize-panel">
            <div class="panel-heading">
              <div><span class="section-index">02</span><h2>AI 商品识别</h2></div>
              <span class="ai-label"><i /> AI ASSIST</span>
            </div>
            <div class="recognize-toolbar">
              <div class="toolbar-copy"><strong>{{ result ? '识别已完成' : '准备好填写商品资料了吗？' }}</strong><span>{{ result ? 'AI 建议可逐项编辑和确认' : '先上传照片，自动整理商品信息' }}</span></div>
              <label v-if="mockEnabled" class="fixture-select">模拟吊牌
                <select v-model="mockFixture" aria-label="选择模拟吊牌价格场景">
                  <option value="tagPrice">照片可读 · ¥399</option>
                  <option value="noTagPrice">未见吊牌 · null</option>
                </select>
              </label>
              <button class="button button--primary recognize-button" type="button" :disabled="busy || saving" @click="recognize">
                <span v-if="busy" class="spinner" />{{ busy ? '请稍候…' : result ? '重新识别' : '识别商品' }} <span v-if="!busy">↗</span>
              </button>
            </div>
            <div class="legend-row"><span class="legend-item"><i class="legend-dash" /> AI 建议</span><span class="legend-item"><i class="legend-solid" /> 已确认 / 已修改</span><span class="legend-confidence"><span class="confidence-scale confidence-scale--low" aria-hidden="true"><i v-for="tick in 5" :key="tick" :class="{ 'confidence-tick--filled': tick <= 2 }" /></span>低置信需核对</span></div>
          </section>

          <section v-if="result" class="panel form-panel">
            <div class="form-title-row">
              <div><span class="section-index">03</span><h2>商品资料</h2><span class="result-chip">{{ RECOGNIZE_FIELD_NAMES.length }} 项识别字段</span></div>
              <span class="confidence-overall"><span>整体置信度</span><b>{{ Math.round(result.confidence.overall * 100) }}%</b></span>
            </div>

            <div class="form-grid">
              <label :class="fieldClass('category')">
                <span class="field-label">{{ fieldLabel('category') }} <span class="confidence-scale" :class="{ 'confidence-scale--low': confidenceTickCount('category') < 3 }" :aria-label="`置信度 ${confidenceTickCount('category')}/5`" role="img"><i v-for="tick in 5" :key="tick" :class="{ 'confidence-tick--filled': tick <= confidenceTickCount('category') }" /></span></span>
                <select v-model="result.category" @change="recordFieldChange('category')"><option v-for="category in CATEGORIES" :key="category" :value="category">{{ category }}</option></select>
                <button class="confirm-field" type="button" @click="markCorrect('category')">AI 对</button>
              </label>
              <label :class="fieldClass('style')">
                <span class="field-label">{{ fieldLabel('style') }} <span class="confidence-scale" :class="{ 'confidence-scale--low': confidenceTickCount('style') < 3 }" :aria-label="`置信度 ${confidenceTickCount('style')}/5`" role="img"><i v-for="tick in 5" :key="tick" :class="{ 'confidence-tick--filled': tick <= confidenceTickCount('style') }" /></span></span>
                <select v-model="result.style" @change="recordFieldChange('style')"><option v-for="style in STYLES" :key="style" :value="style">{{ style }}</option></select>
                <button class="confirm-field" type="button" @click="markCorrect('style')">AI 对</button>
              </label>
              <label :class="fieldClass('audience')">
                <span class="field-label">{{ fieldLabel('audience') }} <span class="confidence-scale" :class="{ 'confidence-scale--low': confidenceTickCount('audience') < 3 }" :aria-label="`置信度 ${confidenceTickCount('audience')}/5`" role="img"><i v-for="tick in 5" :key="tick" :class="{ 'confidence-tick--filled': tick <= confidenceTickCount('audience') }" /></span></span>
                <select v-model="result.audience" @change="recordFieldChange('audience')"><option v-for="audience in AUDIENCES" :key="audience" :value="audience">{{ audience }}</option></select>
                <button class="confirm-field" type="button" @click="markCorrect('audience')">AI 对</button>
              </label>
              <label :class="fieldClass('fabric')">
                <span class="field-label">{{ fieldLabel('fabric') }} <span class="confidence-scale" :class="{ 'confidence-scale--low': confidenceTickCount('fabric') < 3 }" :aria-label="`置信度 ${confidenceTickCount('fabric')}/5`" role="img"><i v-for="tick in 5" :key="tick" :class="{ 'confidence-tick--filled': tick <= confidenceTickCount('fabric') }" /></span><span class="field-optional">看不出可留空</span></span>
                <input v-model="result.fabric" type="text" placeholder="如：棉混纺" @change="recordFieldChange('fabric')">
                <button class="confirm-field" type="button" @click="markCorrect('fabric')">AI 对</button>
              </label>
              <div :class="fieldClass('colors')">
                <span class="field-label">{{ fieldLabel('colors') }} <span class="confidence-scale" :class="{ 'confidence-scale--low': confidenceTickCount('colors') < 3 }" :aria-label="`置信度 ${confidenceTickCount('colors')}/5`" role="img"><i v-for="tick in 5" :key="tick" :class="{ 'confidence-tick--filled': tick <= confidenceTickCount('colors') }" /></span></span>
                <div class="color-options"><button v-for="color in result.colors" :key="`selected-${color.name}`" type="button" class="color-option color-option--selected" :aria-label="`移除颜色 ${color.name}`" @click="toggleColor(color)"><i :style="{ backgroundColor: color.hex }" />{{ color.name }}<b>×</b></button><button v-for="color in availableColors" :key="`option-${color.name}`" type="button" class="color-option" :disabled="result.colors.length >= 4" @click="toggleColor(color)"><i :style="{ backgroundColor: color.hex }" />{{ color.name }}</button></div>
                <div class="custom-color-row"><input v-model="customColor.name" type="text" maxlength="12" placeholder="自定义颜色"><input v-model="customColor.hex" type="text" maxlength="7" aria-label="自定义颜色十六进制色值"><button type="button" :disabled="result.colors.length >= 4" @click="addCustomColor">添加</button></div>
                <button class="confirm-field" type="button" @click="markCorrect('colors')">AI 对</button>
              </div>
              <div :class="fieldClass('seasons')">
                <span class="field-label">{{ fieldLabel('seasons') }} <span class="confidence-scale" :class="{ 'confidence-scale--low': confidenceTickCount('seasons') < 3 }" :aria-label="`置信度 ${confidenceTickCount('seasons')}/5`" role="img"><i v-for="tick in 5" :key="tick" :class="{ 'confidence-tick--filled': tick <= confidenceTickCount('seasons') }" /></span></span>
                <div class="season-options"><label v-for="season in SEASONS" :key="season" class="season-option"><input v-model="result.seasons" type="checkbox" :value="season" @change="recordFieldChange('seasons')"><span>{{ season }}</span></label></div>
                <button class="confirm-field" type="button" @click="markCorrect('seasons')">AI 对</button>
              </div>
              <label :class="fieldClass('item_name')" class="field-card--wide">
                <span class="field-label">{{ fieldLabel('item_name') }} <span class="confidence-scale" :class="{ 'confidence-scale--low': confidenceTickCount('item_name') < 3 }" :aria-label="`置信度 ${confidenceTickCount('item_name')}/5`" role="img"><i v-for="tick in 5" :key="tick" :class="{ 'confidence-tick--filled': tick <= confidenceTickCount('item_name') }" /></span><span class="field-optional">建议商品标题</span></span>
                <input v-model="result.item_name" type="text" maxlength="40" placeholder="输入商品名称" @change="recordFieldChange('item_name')">
                <button class="confirm-field" type="button" @click="markCorrect('item_name')">AI 对</button>
              </label>
              <label :class="fieldClass('tagPrice')" class="price-suggestion">
                <span class="field-label">{{ fieldLabel('tagPrice') }} <span class="confidence-scale" :class="{ 'confidence-scale--low': confidenceTickCount('tagPrice') < 3 }" :aria-label="`置信度 ${confidenceTickCount('tagPrice')}/5`" role="img"><i v-for="tick in 5" :key="tick" :class="{ 'confidence-tick--filled': tick <= confidenceTickCount('tagPrice') }" /></span><span class="field-optional">吊牌不可见时不猜</span></span>
                <span class="price-input-wrap"><b>¥</b><input :value="result.tagPrice ?? ''" type="number" min="0.01" step="0.01" placeholder="未识别" @input="setTagPrice"></span>
                <button class="confirm-field" type="button" @click="markCorrect('tagPrice')">AI 对</button>
              </label>
            </div>
            <p v-if="result.confidence.overall < 0.85" class="review-tip"><span>!</span>请检查标黄字段。低置信结果需要人工确认后再提交。</p>
          </section>

          <section v-if="result" class="panel sku-panel">
            <div class="panel-heading sku-heading">
              <div><span class="section-index">04</span><h2>SKU 规格与价格</h2></div>
              <span class="sku-total"><b>{{ skuCells.length }}</b> 个规格组合</span>
            </div>
            <div class="sku-tools">
              <div class="size-pills"><span class="tool-label">尺码</span><button v-for="size in sizeSelection" :key="size" type="button" class="size-pill" @click="removeSize(size)">{{ size }} <i>×</i></button></div>
              <div class="add-size-control"><select v-model="sizeToAdd" aria-label="选择要添加的尺码"><option v-for="size in SIZES_TOP.filter((item) => !sizeSelection.includes(item))" :key="size" :value="size">{{ size }}</option></select><button type="button" :disabled="sizeSelection.length >= SIZES_TOP.length" @click="addSize">＋ 添加尺码</button></div>
            </div>
            <div v-if="skuCells.length" class="table-scroll">
              <table class="sku-table"><thead><tr><th>颜色 / 尺码</th><th>库存 <small>件</small></th><th>吊牌价 <small>元</small></th><th>批发单价 <small>元</small></th></tr></thead>
                <tbody><tr v-for="cell in skuCells" :key="cell.key"><th><span class="sku-color-dot" :style="{ backgroundColor: cell.hex }" />{{ cell.color }} <span class="sku-size">{{ cell.size }}</span></th><td><input :value="skuValue(cell.key).stock" class="number-input" :class="{ 'number-input--zero': skuValue(cell.key).stock === 0 }" type="number" min="0" step="1" :aria-label="`${cell.color} ${cell.size} 库存`" @input="setSkuValue(cell.key, 'stock', $event)"></td><td><input :value="skuValue(cell.key).tagPrice ?? ''" class="number-input" type="number" min="0.01" step="0.01" :aria-label="`${cell.color} ${cell.size} 吊牌价`" @input="setSkuValue(cell.key, 'tagPrice', $event)"></td><td><input :value="skuValue(cell.key).wholesalePrice ?? ''" class="number-input" type="number" min="0.01" step="0.01" :aria-label="`${cell.color} ${cell.size} 批发单价`" @input="setSkuValue(cell.key, 'wholesalePrice', $event)"></td></tr></tbody>
              </table>
            </div>
            <div class="sku-summary"><span>已填写 <b>{{ readySkuCount }} / {{ skuCells.length }}</b> 个规格</span><span class="summary-hint">吊牌价已按 AI 建议预填，可逐项调整</span></div>
          </section>

          <section v-if="result" class="panel description-panel">
            <div class="panel-heading"><div><span class="section-index">05</span><h2>商品描述</h2></div><span class="manual-label">W1 · 手动填写</span></div>
            <textarea v-model="description" rows="3" placeholder="补充面料、版型和穿着场景等商品描述…" aria-label="商品描述" />
            <div class="description-note">流式 AI 文案将在 W2 接入；当前内容会随记录保存。</div>
          </section>

          <section v-if="result" class="submit-bar">
            <div class="submit-meta"><span class="save-mark">◈</span><span><b>准备保存商品记录</b><small>{{ imageQueue.length }} 张照片 · {{ skuCells.length }} 个 SKU · {{ editedFieldCount }} 项修正</small></span></div>
            <button class="button button--primary submit-button" type="button" :disabled="saving || busy" @click="submitRecord">{{ saving ? '保存中…' : '保存商品记录' }} <span>→</span></button>
          </section>
        </section>
      </div>

      <section class="records-section">
        <div class="records-heading"><div><span class="section-index">06</span><h2>最近录入</h2><span class="records-count">{{ recordList.length }} 条</span></div><span class="records-caption">本机保存 · 仅供当前演示环境使用</span></div>
        <div v-if="!recordList.length" class="records-empty"><span class="empty-icon">▤</span><span>保存后的商品会显示在这里</span></div>
        <div v-else class="records-list"><article v-for="record in recordList.slice(0, 5)" :key="record.id" class="record-row"><span class="record-sequence">{{ recordList.indexOf(record) + 1 < 10 ? `0${recordList.indexOf(record) + 1}` : recordList.indexOf(record) + 1 }}</span><div class="record-name"><strong>{{ record.recognize.item_name }}</strong><span>{{ record.recognize.category }} · {{ record.recognize.colors.map((color) => color.name).join(' / ') }}</span></div><span class="record-sku">{{ record.sku.length }} SKU</span><span class="record-time">{{ new Date(record.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }}</span></article></div>
      </section>

      <footer class="app-footer"><span>snap2sku <i>·</i> 衣物商品录入工作台</span><span><b>W1</b> Local prototype</span></footer>
    </main>
  </div>
</template>

<style>
:root { font-synthesis: none; }
.app-shell { min-height: 100vh; }
.workspace { width: min(1240px, calc(100% - 48px)); margin: 0 auto; }
.page-heading { display: flex; justify-content: space-between; align-items: end; padding: 34px 0 27px; }
.eyebrow { color: var(--c-primary); font-family: var(--font-mono); font-size: var(--font-xs); font-weight: 600; letter-spacing: .14em; }
.eyebrow span { padding: 0 4px; color: var(--c-accent); }
h1,h2,p { margin: 0; }
h1 { margin-top: 9px; font-family: var(--font-heading); font-size: var(--font-xl); font-weight: 600; letter-spacing: -.04em; }
h1 em { color: var(--c-accent); font-style: normal; }
.page-heading p { margin-top: 7px; color: var(--c-ink-2); font-size: var(--font-sm); }
.heading-note { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; color: var(--c-ink-2); font-size: var(--font-xs); line-height: 1.7; }
.note-icon { width: 27px; height: 27px; display: grid; place-items: center; border: 1px solid var(--c-border); color: var(--c-primary); font-family: var(--font-mono); }
.notice { display: flex; gap: 10px; align-items: center; margin: 0 0 14px; padding: 10px 13px; border: 1px solid var(--c-border); font-size: var(--font-xs); }
.notice > span { font-family: var(--font-mono); font-weight: 700; }
.notice--error { border-color: color-mix(in oklch, var(--c-error) 35%, var(--c-border)); color: var(--c-error); background: color-mix(in oklch, var(--c-error) 4%, var(--c-surface)); }
.notice--success { color: var(--c-success); background: color-mix(in oklch, var(--c-success) 4%, var(--c-surface)); }
.work-grid { display: grid; grid-template-columns: minmax(280px, 340px) minmax(0, 1fr); align-items: start; gap: 16px; }
.upload-column,.details-column { display: grid; gap: 14px; min-width: 0; }
.panel { background: var(--c-surface); border: 1px solid var(--c-border); box-shadow: var(--shadow-card); }
.upload-panel { padding: 17px; }
.panel-heading,.panel-heading > div,.form-title-row,.form-title-row > div,.records-heading,.records-heading > div { display: flex; align-items: center; }
.panel-heading { justify-content: space-between; margin-bottom: 15px; }
.panel-heading > div { gap: 9px; }
.section-index { color: var(--c-accent); font-family: var(--font-mono); font-size: var(--font-xs); font-weight: 600; letter-spacing: .04em; }
h2 { font-family: var(--font-heading); font-size: var(--font-base); font-weight: 600; letter-spacing: -.01em; }
.small-count { color: var(--c-ink-2); font-family: var(--font-mono); font-size: var(--font-xs); }
.dropzone { min-height: 250px; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 8px; overflow: hidden; border: 1px dashed color-mix(in oklch, var(--c-primary) 45%, var(--c-border)); background: color-mix(in oklch, var(--c-primary) 2%, var(--c-surface)); text-align: center; transition: background var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease); }
.dropzone--active { border-style: solid; background: color-mix(in oklch, var(--c-primary) 6%, var(--c-surface)); }
.dropzone--has-images { padding: 9px; }
.example-button { margin-top: 8px; padding: 6px 10px; border: 1px solid var(--c-border); background: var(--c-surface); color: var(--c-primary); font-size: var(--font-xs); cursor: pointer; }
.upload-illustration { position: relative; width: 88px; height: 81px; margin-bottom: 7px; color: var(--c-primary); }
.hanger-line { position: absolute; top: 33px; left: 7px; width: 74px; height: 1px; background: color-mix(in oklch, var(--c-primary) 28%, transparent); transform: rotate(-3deg); }
.hanger-hook { position: absolute; top: 0; left: 39px; color: var(--c-accent); font-family: var(--font-heading); font-size: var(--font-xl); transform: rotate(90deg); }
.hanger-shape { position: absolute; top: 18px; left: 27px; width: 36px; height: 53px; display: grid; place-items: center; border: 1px solid var(--c-primary); background: var(--c-surface); color: var(--c-accent); font-family: var(--font-heading); font-size: var(--font-base); transform: rotate(-4deg); }
.upload-illustration i { position: absolute; right: 0; bottom: 2px; width: 19px; height: 19px; display: grid; place-items: center; border-radius: var(--radius-full); background: var(--c-accent); color: var(--c-surface); font-size: var(--font-sm); font-style: normal; }
.dropzone > strong { font-family: var(--font-heading); font-size: var(--font-sm); font-weight: 600; }
.drop-hint { color: var(--c-ink-2); font-size: var(--font-xs); }
.file-rules { margin-top: 7px; color: var(--c-ink-2); font-family: var(--font-mono); font-size: var(--font-xs); letter-spacing: .02em; }
.file-rules b { padding: 0 3px; color: var(--c-accent); }
.preview-stage { position: relative; width: 100%; height: 177px; overflow: hidden; background: var(--c-bg); }
.preview-stage img { width: 100%; height: 100%; object-fit: contain; }
.preview-tag { position: absolute; left: 8px; top: 8px; padding: 4px 6px; background: var(--c-surface); color: var(--c-success); font-family: var(--font-mono); font-size: var(--font-xs); }
.preview-remove { position: absolute; right: 7px; top: 7px; width: 23px; height: 23px; border: 0; background: var(--c-surface); cursor: pointer; font-size: var(--font-lg); }
.image-strip { width: 100%; display: flex; gap: 6px; overflow-x: auto; padding: 9px 0 1px; }
.thumb { position: relative; width: 44px; height: 44px; flex: 0 0 44px; padding: 0; overflow: hidden; border: 1px solid var(--c-border); background: var(--c-bg); cursor: pointer; }
.thumb--selected { border: 2px solid var(--c-primary); }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.thumb--recognizing { animation: thumbnail-breathe 1.2s ease-in-out infinite alternate; }
@keyframes thumbnail-breathe { from { opacity: .6; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .thumb--recognizing { animation: none; opacity: 1; } }
.thumb i { position: absolute; right: 2px; bottom: 2px; width: 13px; height: 13px; display: grid; place-items: center; border-radius: var(--radius-full); background: var(--c-success); color: var(--c-surface); font-size: var(--font-xs); font-style: normal; }
.thumb--add { color: var(--c-primary); font-size: var(--font-base); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
.button { min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 10px; padding: 0 14px; border: 1px solid transparent; border-radius: var(--radius); font-size: var(--font-xs); font-weight: 600; cursor: pointer; transition: background var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease), opacity var(--t-fast) var(--ease); }
.button:disabled { opacity: .55; cursor: not-allowed; }
.button--outline { border-color: var(--c-border); background: transparent; color: var(--c-primary); }
.button--outline:hover { border-color: var(--c-primary); background: color-mix(in oklch, var(--c-primary) 3%, var(--c-surface)); }
.button--primary { background: var(--c-accent); color: var(--c-surface); }
.button--primary:hover:not(:disabled) { background: color-mix(in oklch, var(--c-accent) 88%, var(--c-ink)); }
.choose-button { width: 100%; margin-top: 12px; }
.choose-button span { font-size: var(--font-base); font-weight: 400; }
.compression-list { display: grid; gap: 1px; margin-top: 11px; }
.compression-row { min-width: 0; display: grid; grid-template-columns: 12px minmax(0, 1fr) auto 16px; align-items: center; gap: 5px; padding: 6px 0; border-bottom: 1px solid color-mix(in oklch, var(--c-border) 65%, transparent); }
.compression-status { color: var(--c-primary); font-family: var(--font-mono); font-size: var(--font-xs); }
.compression-status--uploaded { color: var(--c-success); }
.compression-status--error { color: var(--c-error); }
.compression-name { overflow: hidden; color: var(--c-ink-2); font-size: var(--font-xs); text-overflow: ellipsis; white-space: nowrap; }
.compression-size { color: var(--c-ink); font-family: var(--font-mono); font-size: var(--font-xs); font-variant-numeric: tabular-nums; white-space: nowrap; }
.compression-size i { color: var(--c-accent); font-style: normal; }
.row-remove { border: 0; background: transparent; color: var(--c-ink-2); cursor: pointer; }
.upload-footnote { display: flex; gap: 7px; align-items: center; margin-top: 13px; color: var(--c-ink-2); font-size: var(--font-xs); }
.lock-mark { color: var(--c-success); }
.guide-card { display: grid; grid-template-columns: 40px 1fr; gap: 12px; align-items: center; padding: 14px 16px; border: 1px solid var(--c-border); background: color-mix(in oklch, var(--c-warn-bg) 30%, var(--c-surface)); }
.guide-stamp { width: 36px; height: 36px; display: grid; place-content: center; border: 1px solid color-mix(in oklch, var(--c-accent) 35%, var(--c-border)); color: var(--c-accent); font-family: var(--font-mono); font-size: var(--font-xs); line-height: 1.2; text-align: center; transform: rotate(-4deg); }
.guide-stamp small { font-size: var(--font-xs); }
.guide-card strong { font-family: var(--font-heading); font-size: var(--font-xs); }
.guide-card p { margin-top: 4px; color: var(--c-ink-2); font-size: var(--font-xs); line-height: 1.6; }
.recognize-panel { padding: 16px 18px 12px; }
.ai-label { color: var(--c-primary); font-family: var(--font-mono); font-size: var(--font-xs); letter-spacing: .1em; }
.ai-label i { display: inline-block; width: 5px; height: 5px; margin-right: 5px; border-radius: var(--radius-full); background: var(--c-accent); vertical-align: 1px; }
.recognize-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 13px; border: 1px solid var(--c-border); background: var(--c-bg); }
.toolbar-copy { display: grid; gap: 4px; }
.toolbar-copy strong { font-size: var(--font-xs); font-weight: 600; }
.toolbar-copy > span { color: var(--c-ink-2); font-size: var(--font-xs); }
.recognize-button { min-width: 126px; }
.recognize-button > span:last-child,.submit-button > span { font-family: var(--font-mono); font-size: var(--font-sm); }
.fixture-select { display: grid; gap: 3px; color: var(--c-ink-2); font-size: var(--font-xs); }
.fixture-select select { max-width: 150px; padding: 5px 7px; border: 1px solid var(--c-border); border-radius: var(--radius); background: var(--c-surface); color: var(--c-ink); font-size: var(--font-xs); }
.legend-row { display: flex; align-items: center; gap: 15px; padding-top: 12px; }
.legend-item,.legend-confidence { display: inline-flex; align-items: center; gap: 6px; color: var(--c-ink-2); font-size: var(--font-xs); }
.legend-dash,.legend-solid { width: 15px; height: 9px; border: 1px dashed var(--c-primary); }
.legend-solid { border-style: solid; }
.legend-confidence { margin-left: auto; }
.confidence-scale { display: inline-grid; grid-template-columns: repeat(5, 5px); gap: 2px; margin-left: 5px; vertical-align: middle; }
.confidence-scale i { width: 5px; height: 7px; border: 1px solid var(--c-primary); background: transparent; }
.confidence-scale i.confidence-tick--filled { background: var(--c-primary); }
.confidence-scale--low { color: var(--c-warn-ink); }
.confidence-scale--low i { border-color: var(--c-warn-ink); }
.confidence-scale--low i.confidence-tick--filled { background: var(--c-warn-ink); }
.form-panel,.sku-panel,.description-panel { padding: 17px 18px; }
.form-title-row { justify-content: space-between; margin-bottom: 14px; }
.form-title-row > div { gap: 9px; }
.result-chip { margin-left: 2px; padding: 3px 6px; border: 1px solid var(--c-border); color: var(--c-ink-2); font-family: var(--font-mono); font-size: var(--font-xs); }
.confidence-overall { display: flex; align-items: baseline; gap: 7px; color: var(--c-ink-2); font-size: var(--font-xs); }
.confidence-overall b { color: var(--c-primary); font-family: var(--font-mono); font-size: var(--font-xs); font-variant-numeric: tabular-nums; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
.field-card { position: relative; min-width: 0; display: grid; align-content: start; gap: 7px; padding: 10px; border: 1px dashed color-mix(in oklch, var(--c-primary) 45%, var(--c-border)); background: var(--c-surface); transition: border-color var(--t-mid) var(--ease), background var(--t-mid) var(--ease); }
.field-card--confirmed { border-style: solid; border-color: color-mix(in oklch, var(--c-primary) 55%, var(--c-border)); }
.field-card--low { border-color: color-mix(in oklch, var(--c-warn-ink) 42%, var(--c-border)); background: color-mix(in oklch, var(--c-warn-bg) 55%, var(--c-surface)); }
.field-card--wide { grid-column: span 2; }
.field-label { display: flex; align-items: center; gap: 6px; color: var(--c-ink-2); font-family: var(--font-mono); font-size: var(--font-xs); letter-spacing: .02em; }
.field-optional { margin-left: auto; color: color-mix(in oklch, var(--c-ink-2) 75%, transparent); font-family: var(--font-body); font-size: var(--font-xs); letter-spacing: 0; }
.field-card select,.field-card input:not([type=checkbox]) { width: 100%; min-width: 0; height: 31px; padding: 0 8px; border: 1px solid var(--c-border); border-radius: var(--radius); background: var(--c-surface); color: var(--c-ink); font-size: var(--font-xs); }
.confirm-field { position: absolute; right: 8px; bottom: 14px; padding: 2px 5px; border: 0; background: var(--c-surface); color: var(--c-primary); font-size: var(--font-xs); cursor: pointer; opacity: .65; }
.confirm-field:hover { opacity: 1; text-decoration: underline; }
.color-options { display: flex; flex-wrap: wrap; gap: 5px; padding-right: 28px; }
.color-option { display: inline-flex; align-items: center; gap: 4px; padding: 4px 5px; border: 1px solid transparent; background: transparent; color: var(--c-ink-2); font-size: var(--font-xs); cursor: pointer; }
.color-option--selected { border-color: var(--c-primary); color: var(--c-ink); background: color-mix(in oklch, var(--c-primary) 5%, var(--c-surface)); }
.color-option:disabled { opacity: .45; cursor: not-allowed; }
.color-option i,.sku-color-dot { width: 10px; height: 10px; display: inline-block; border: 1px solid color-mix(in oklch, var(--c-ink-2) 25%, transparent); border-radius: var(--radius-full); }
.color-option b { padding-left: 2px; color: var(--c-accent); font-weight: 500; }
.custom-color-row { display: flex; gap: 5px; }
.custom-color-row input { min-width: 0; height: 26px; padding: 0 5px; border: 1px solid var(--c-border); border-radius: var(--radius); background: var(--c-surface); font-size: var(--font-xs); }
.custom-color-row input:first-child { flex: 1; }
.custom-color-row input:nth-child(2) { width: 82px; font-family: var(--font-mono); text-transform: uppercase; }
.custom-color-row button { min-width: 40px; border: 1px solid var(--c-border); background: var(--c-surface); color: var(--c-primary); font-size: var(--font-xs); cursor: pointer; }
.custom-color-row button:disabled { opacity: .45; cursor: not-allowed; }
.season-options { display: flex; gap: 12px; padding: 4px 0; }
.season-option { display: inline-flex; align-items: center; gap: 4px; color: var(--c-ink); font-size: var(--font-xs); cursor: pointer; }
.season-option input { width: 12px; height: 12px; margin: 0; accent-color: var(--c-primary); }
.price-input-wrap { display: flex; align-items: center; border-bottom: 1px solid var(--c-border); }
.price-input-wrap b { color: var(--c-accent); font-family: var(--font-mono); font-size: var(--font-xs); }
.field-card .price-input-wrap input { border: 0; background: transparent; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.review-tip { display: flex; gap: 7px; align-items: center; margin-top: 11px; color: var(--c-warn-ink); font-size: var(--font-xs); }
.review-tip span { width: 13px; height: 13px; display: grid; place-items: center; border: 1px solid color-mix(in oklch, var(--c-warn-ink) 50%, transparent); border-radius: var(--radius-full); font-family: var(--font-mono); font-size: var(--font-xs); }
.sku-heading { margin-bottom: 10px; }
.sku-total { color: var(--c-ink-2); font-size: var(--font-xs); }
.sku-total b { color: var(--c-primary); font-family: var(--font-mono); font-size: var(--font-xs); }
.sku-tools { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding-bottom: 11px; }
.size-pills,.add-size-control { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.tool-label { margin-right: 3px; color: var(--c-ink-2); font-family: var(--font-mono); font-size: var(--font-xs); }
.size-pill { padding: 4px 6px; border: 1px solid var(--c-border); background: var(--c-surface); color: var(--c-ink); font-family: var(--font-mono); font-size: var(--font-xs); cursor: pointer; }
.size-pill i { padding-left: 4px; color: var(--c-ink-2); font-style: normal; }
.add-size-control select { max-width: 68px; height: 27px; border: 1px solid var(--c-border); border-radius: var(--radius); background: var(--c-surface); font-size: var(--font-xs); }
.add-size-control button { height: 27px; padding: 0 6px; border: 1px solid var(--c-border); background: transparent; color: var(--c-primary); font-size: var(--font-xs); cursor: pointer; }
.add-size-control button:disabled { opacity: .5; cursor: not-allowed; }
.table-scroll { overflow-x: auto; border: 1px solid var(--c-border); }
.sku-table { width: 100%; border-collapse: collapse; font-size: var(--font-xs); }
.sku-table th,.sku-table td { height: 32px; padding: 4px 9px; border-bottom: 1px solid color-mix(in oklch, var(--c-border) 68%, transparent); text-align: right; }
.sku-table thead th { position: sticky; top: 0; height: 29px; background: var(--c-bg); color: var(--c-ink-2); font-family: var(--font-mono); font-size: var(--font-xs); font-weight: 500; letter-spacing: .02em; }
.sku-table thead th:first-child,.sku-table tbody th { text-align: left; }
.sku-table th small { color: color-mix(in oklch, var(--c-ink-2) 75%, transparent); font-family: var(--font-body); font-size: var(--font-xs); }
.sku-table tbody tr:nth-child(even) { background: color-mix(in oklch, var(--c-bg) 45%, var(--c-surface)); }
.sku-table tbody th { font-size: var(--font-xs); font-weight: 500; white-space: nowrap; }
.sku-color-dot { width: 9px; height: 9px; margin-right: 5px; vertical-align: -1px; }
.sku-size { margin-left: 5px; padding: 2px 4px; background: var(--c-bg); color: var(--c-ink-2); font-family: var(--font-mono); font-size: var(--font-xs); }
.number-input { width: 78px; height: 25px; padding: 0 6px; border: 1px solid transparent; border-bottom-color: var(--c-border); background: transparent; color: var(--c-ink); font-family: var(--font-mono); font-size: var(--font-xs); font-variant-numeric: tabular-nums; text-align: right; }
.number-input:focus { border-color: var(--c-primary); background: var(--c-surface); outline: 0; }
.number-input--zero { color: var(--c-error); }
.sku-summary { display: flex; justify-content: space-between; gap: 8px; padding-top: 10px; color: var(--c-ink-2); font-size: var(--font-xs); }
.sku-summary b { color: var(--c-primary); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.summary-hint { text-align: right; }
.manual-label { padding: 4px 6px; border: 1px solid var(--c-border); color: var(--c-ink-2); font-family: var(--font-mono); font-size: var(--font-xs); }
.description-panel textarea { width: 100%; min-height: 70px; padding: 9px; resize: vertical; border: 1px solid var(--c-border); border-radius: var(--radius); background: var(--c-surface); color: var(--c-ink); font-size: var(--font-xs); line-height: 1.6; }
.description-panel textarea::placeholder { color: var(--c-ink-2); }
.description-note { margin-top: 6px; color: var(--c-ink-2); font-size: var(--font-xs); }
.submit-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 15px; border: 1px solid var(--c-border); background: var(--c-surface); }
.submit-meta { display: flex; align-items: center; gap: 10px; }
.save-mark { width: 25px; height: 25px; display: grid; place-items: center; border: 1px solid var(--c-border); color: var(--c-success); }
.submit-meta > span:last-child { display: grid; gap: 3px; }
.submit-meta b { font-size: var(--font-xs); font-weight: 600; }
.submit-meta small { color: var(--c-ink-2); font-family: var(--font-mono); font-size: var(--font-xs); }
.submit-button { min-width: 150px; min-height: 38px; }
.spinner { width: 11px; height: 11px; border: 1px solid color-mix(in oklch, var(--c-surface) 40%, transparent); border-top-color: var(--c-surface); border-radius: var(--radius-full); animation: spin .7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.records-section { margin-top: 26px; border-top: 1px solid var(--c-border); }
.records-heading { justify-content: space-between; padding: 16px 0 11px; }
.records-heading > div { gap: 9px; }
.records-count { padding: 2px 6px; border: 1px solid var(--c-border); color: var(--c-ink-2); font-family: var(--font-mono); font-size: var(--font-xs); }
.records-caption { color: var(--c-ink-2); font-size: var(--font-xs); }
.records-empty { display: flex; justify-content: center; align-items: center; gap: 8px; min-height: 64px; border: 1px dashed var(--c-border); color: var(--c-ink-2); font-size: var(--font-xs); }
.empty-icon { color: var(--c-primary); font-family: var(--font-mono); font-size: var(--font-sm); }
.records-list { border: 1px solid var(--c-border); background: var(--c-surface); }
.record-row { display: grid; grid-template-columns: 38px minmax(0, 1fr) 75px 90px; align-items: center; gap: 12px; min-height: 52px; padding: 7px 13px; border-bottom: 1px solid color-mix(in oklch, var(--c-border) 70%, transparent); }
.record-sequence { color: var(--c-accent); font-family: var(--font-mono); font-size: var(--font-xs); }
.record-name { display: grid; gap: 4px; min-width: 0; }
.record-name strong { overflow: hidden; font-size: var(--font-xs); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.record-name span,.record-time,.record-sku { color: var(--c-ink-2); font-size: var(--font-xs); }
.record-sku { font-family: var(--font-mono); text-align: right; }
.record-time { font-family: var(--font-mono); font-variant-numeric: tabular-nums; text-align: right; }
.app-footer { display: flex; justify-content: space-between; padding: 15px 0 20px; color: var(--c-ink-2); font-family: var(--font-mono); font-size: var(--font-xs); }
.app-footer i { color: var(--c-accent); font-style: normal; }
.app-footer b { color: var(--c-primary); font-weight: 600; }
@media (max-width: 900px) {
  .workspace { width: min(100% - 32px, 700px); }
  .work-grid { grid-template-columns: minmax(0, 1fr); }
  .upload-column { grid-template-columns: minmax(0, 1fr) minmax(210px, .7fr); align-items: stretch; }
  .guide-card { align-self: start; }
}
@media (max-width: 600px) {
  .workspace { width: calc(100% - 28px); }
  .page-heading { padding: 25px 0 20px; }
  .heading-note { display: none; }
  .upload-column { grid-template-columns: 1fr; }
  .guide-card { grid-row: 1; }
  .guide-card p { max-width: none; }
  .recognize-panel,.form-panel,.sku-panel,.description-panel { padding: 14px; }
  .recognize-toolbar { flex-wrap: wrap; }
  .toolbar-copy { flex: 1 1 100%; }
  .fixture-select { flex: 1; }
  .legend-row { flex-wrap: wrap; gap: 8px 12px; }
  .legend-confidence { margin-left: 0; }
  .form-grid { grid-template-columns: 1fr; }
  .field-card--wide { grid-column: auto; }
  .result-chip { display: none; }
  .confidence-overall { align-items: end; flex-direction: column; gap: 2px; }
  .sku-tools { align-items: flex-start; flex-direction: column; }
  .sku-table th,.sku-table td { padding-right: 6px; padding-left: 6px; }
  .number-input { width: 66px; }
  .sku-summary { flex-direction: column; }
  .summary-hint { text-align: left; }
  .submit-bar { align-items: stretch; flex-direction: column; }
  .submit-button { width: 100%; }
  .records-caption { display: none; }
  .record-row { grid-template-columns: 24px minmax(0, 1fr) 44px; gap: 8px; }
  .record-time { grid-column: 2 / -1; justify-self: start; }
}
</style>
