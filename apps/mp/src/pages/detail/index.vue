<script setup lang="ts">
import { computed, ref } from "vue";
import { onLoad, onPullDownRefresh, onShow } from "@dcloudio/uni-app";
import {
  AUDIENCES,
  CATEGORIES,
  DescriptionVariantsSchema,
  RecognizeResultSchema,
  SEASONS,
  SKUItemSchema,
  SIZES_TOP,
  STYLES,
  type DescriptionPlatform,
  type DescribeResult,
  type ProductRecordWithImageUrls,
  type RecognizeResult,
  type SKUItem,
} from "@scope/shared/schema";
import {
  absoluteImageUrl,
  parseDescribeResultConfidence,
  parseProductRecordList,
  parseProductRecordWithImageUrls,
  parseSseEvents,
  requestApi,
  requestSse,
} from "../../api";

interface RuntimeInfo {
  mock: boolean;
  priceConfigured: boolean;
  spentCny: number;
  reservedCny: number;
  pendingReconcile: number;
  budget: number;
  remainingCny: number;
}

const record = ref<ProductRecordWithImageUrls>();
const recordId = ref("");
const busy = ref(false);
const loading = ref(true);
const editing = ref(false);
const message = ref("");
const errorMessage = ref("");
const operationMessage = ref("");
const runtimeInfo = ref<RuntimeInfo>();
const currentImage = ref(0);
const activePlatform = ref<DescriptionPlatform>("douyin");
const descriptionText = ref("");
const descriptionConfidence = ref<number>();
const variantText = ref<Partial<Record<DescriptionPlatform, string>>>({});
const variantConfidence = ref<
  Partial<Record<DescriptionPlatform, DescribeResult["confidence"]>>
>({});
const recognizeDraft = ref<RecognizeResult>();
const skuDraft = ref<SKUItem[]>([]);
const colorText = ref("");
const seasonText = ref("");
const platformLabels: Record<DescriptionPlatform, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  shipinhao: "视频号",
};
const platforms: DescriptionPlatform[] = ["douyin", "xiaohongshu", "shipinhao"];
const activeVariantText = computed(
  () =>
    variantText.value[activePlatform.value] ??
    record.value?.descriptionVariantsAi?.[activePlatform.value]?.description ??
    "",
);
const hasBudget = computed(
  () =>
    !runtimeInfo.value ||
    runtimeInfo.value.mock ||
    runtimeInfo.value.remainingCny > 0,
);

onLoad((query) => {
  recordId.value = typeof query?.id === "string" ? query.id : "";
  if (!recordId.value) errorMessage.value = "E_VALIDATION: 缺少商品记录编号";
  seedFromCache();
  void loadRuntimeInfo();
});
onShow(() => {
  if (recordId.value) void loadRecord();
});
onPullDownRefresh(() => void refreshPage());

function seedFromCache(): void {
  const cached: unknown = uni.getStorageSync("snap2sku-record-cache");
  try {
    const entries = parseProductRecordList(cached);
    const found = entries.find((item) => item.id === recordId.value);
    if (found) setRecord(found);
  } catch {
    // 缓存只用于先展示内容，最终仍以服务端刷新结果为准。
  }
}

async function loadRecord(): Promise<void> {
  if (!recordId.value) return;
  loading.value = !record.value;
  try {
    const records = parseProductRecordList(await requestApi("/api/records"));
    uni.setStorageSync("snap2sku-record-cache", records);
    const found = records.find((item) => item.id === recordId.value);
    if (!found) throw new Error("E_RECORD_NOT_FOUND: 找不到这条商品记录");
    setRecord(found);
    errorMessage.value = "";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "E_UPSTREAM: 记录暂时无法读取";
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
}

async function loadRuntimeInfo(): Promise<void> {
  try {
    const value: unknown = await requestApi("/api/runtime-info");
    if (isRuntimeInfo(value)) runtimeInfo.value = value;
  } catch {
    runtimeInfo.value = undefined;
  }
}

async function refreshPage(): Promise<void> {
  await Promise.all([loadRecord(), loadRuntimeInfo()]);
}

function setRecord(value: ProductRecordWithImageUrls): void {
  record.value = value;
  if (!editing.value) resetDraft(value);
  descriptionText.value = value.descriptionAi ?? value.description;
  variantText.value = {
    douyin: value.descriptionVariantsAi?.douyin.description,
    xiaohongshu: value.descriptionVariantsAi?.xiaohongshu.description,
    shipinhao: value.descriptionVariantsAi?.shipinhao.description,
  };
  variantConfidence.value = {
    douyin: value.descriptionVariantsAi?.douyin.confidence,
    xiaohongshu: value.descriptionVariantsAi?.xiaohongshu.confidence,
    shipinhao: value.descriptionVariantsAi?.shipinhao.confidence,
  };
  currentImage.value = Math.min(
    currentImage.value,
    Math.max(value.imageUrls.length - 1, 0),
  );
}

function resetDraft(value: ProductRecordWithImageUrls): void {
  recognizeDraft.value = JSON.parse(
    JSON.stringify(value.recognize),
  ) as RecognizeResult;
  skuDraft.value = JSON.parse(JSON.stringify(value.sku)) as SKUItem[];
  colorText.value = value.recognize.colors
    .map((color) => `${color.name} | ${color.hex}`)
    .join(", ");
  seasonText.value = value.recognize.seasons.join("、");
}

function editRecord(): void {
  if (!record.value) return;
  resetDraft(record.value);
  editing.value = true;
  message.value = "";
  errorMessage.value = "";
}

function cancelEdit(): void {
  if (record.value) resetDraft(record.value);
  editing.value = false;
}

function updateColors(): void {
  if (!recognizeDraft.value) return;
  recognizeDraft.value.colors = colorText.value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [name = "", hex = ""] = item.split("|").map((part) => part.trim());
      return { name, hex };
    });
}

function updateSeasons(): void {
  if (recognizeDraft.value) {
    recognizeDraft.value.seasons = seasonText.value
      .split(/[、,，\s]+/)
      .filter(Boolean) as RecognizeResult["seasons"];
  }
}

function updateTagPrice(event: Event): void {
  if (!recognizeDraft.value || !hasMiniInputValue(event)) return;
  const value = event.detail.value.trim();
  recognizeDraft.value.tagPrice = value === "" ? null : Number(value);
}

function hasMiniInputValue(
  value: Event,
): value is Event & { detail: { value: string } } {
  return (
    "detail" in value &&
    typeof value.detail === "object" &&
    value.detail !== null &&
    "value" in value.detail &&
    typeof value.detail.value === "string"
  );
}

async function saveEdit(): Promise<void> {
  if (!record.value || !recognizeDraft.value) return;
  updateColors();
  updateSeasons();
  const updatedRecognize = {
    ...recognizeDraft.value,
    fabric: recognizeDraft.value.fabric || null,
  };
  const checkedRecognize = RecognizeResultSchema.safeParse(updatedRecognize, {
    jitless: true,
  });
  const checkedSku = SKUItemSchema.array().min(1).safeParse(skuDraft.value, {
    jitless: true,
  });
  if (!checkedRecognize.success || !checkedSku.success) {
    errorMessage.value =
      "E_VALIDATION: 请检查商品字段、颜色格式和 SKU 价格后再保存";
    return;
  }
  busy.value = true;
  errorMessage.value = "";
  message.value = "";
  try {
    const value = await requestApi(
      `/api/records/${encodeURIComponent(record.value.id)}`,
      "PUT",
      {
        detailsVersion: record.value.detailsVersion,
        recognize: checkedRecognize.data,
        sku: checkedSku.data,
      },
    );
    setRecord(parseProductRecordWithImageUrls(value));
    editing.value = false;
    message.value =
      "资料已保存；如修改了品类、风格、颜色、季节或人群，请手动重新生成文案。";
    await loadRuntimeInfo();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "E_UPSTREAM: 保存失败，请重试";
  } finally {
    busy.value = false;
  }
}

async function generateDescription(): Promise<void> {
  if (!record.value || !canGenerate()) return;
  busy.value = true;
  errorMessage.value = "";
  operationMessage.value = "正在生成商品描述，请稍候…";
  descriptionText.value = "";
  descriptionConfidence.value = undefined;
  try {
    const events = await requestSse(
      `/api/records/${encodeURIComponent(record.value.id)}/describe`,
    );
    let completed = false;
    let nextText = "";
    for (const event of events) {
      if (event.event === "error") throw eventError(event.data);
      if (event.event === "chunk") {
        const payload: unknown = parseEventJson(event.data);
        if (isTextPayload(payload)) nextText += payload.text;
      }
      if (event.event === "generated") {
        const payload: unknown = parseEventJson(event.data);
        if (isObject(payload)) {
          const confidence = parseDescribeResultConfidence(payload.confidence);
          if (confidence) descriptionConfidence.value = confidence.description;
          if (isNonNegativeNumber(payload.costEstimate) && record.value)
            record.value.costEstimate = payload.costEstimate;
        }
      }
      if (event.event === "done" && event.data === "[DONE]") completed = true;
    }
    if (!completed) throw new Error("E_UPSTREAM: 描述未保存，请重试");
    descriptionText.value = nextText;
    if (record.value) record.value.descriptionAi = nextText;
    message.value = "商品描述已生成并保存。";
    await loadRecord();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "E_UPSTREAM: 描述生成失败";
  } finally {
    busy.value = false;
    operationMessage.value = "";
    await loadRuntimeInfo();
  }
}

async function generateVariants(): Promise<void> {
  if (!record.value || !canGenerate()) return;
  busy.value = true;
  errorMessage.value = "";
  operationMessage.value = "正在依次生成抖音、小红书和视频号文案，请稍候…";
  variantText.value = {};
  variantConfidence.value = {};
  try {
    const events = await requestSse(
      `/api/records/${encodeURIComponent(record.value.id)}/describe-variants`,
    );
    let completed = false;
    const texts: Partial<Record<DescriptionPlatform, string>> = {};
    const confidences: Partial<
      Record<DescriptionPlatform, DescribeResult["confidence"]>
    > = {};
    for (const event of events) {
      if (event.event === "error") throw eventError(event.data);
      if (event.event === "chunk") {
        const payload: unknown = parseEventJson(event.data);
        if (isVariantChunk(payload))
          texts[payload.platform] =
            `${texts[payload.platform] ?? ""}${payload.text}`;
      }
      if (event.event === "generated") {
        const payload: unknown = parseEventJson(event.data);
        if (isObject(payload) && isDescriptionPlatform(payload.platform)) {
          const parsed = DescriptionVariantsSchema.shape[
            payload.platform
          ].shape.confidence.safeParse(payload.confidence, { jitless: true });
          if (parsed.success) confidences[payload.platform] = parsed.data;
          if (isNonNegativeNumber(payload.costEstimate) && record.value)
            record.value.costEstimate = payload.costEstimate;
        }
      }
      if (event.event === "done" && event.data === "[DONE]") completed = true;
    }
    if (
      !completed ||
      platforms.some((platform) => !texts[platform] || !confidences[platform])
    ) {
      throw new Error("E_UPSTREAM: 三平台文案未完整保存，请重试");
    }
    variantText.value = texts;
    variantConfidence.value = confidences;
    if (record.value) {
      record.value.descriptionVariantsAi = {
        douyin: {
          description: texts.douyin ?? "",
          confidence: confidences.douyin!,
        },
        xiaohongshu: {
          description: texts.xiaohongshu ?? "",
          confidence: confidences.xiaohongshu!,
        },
        shipinhao: {
          description: texts.shipinhao ?? "",
          confidence: confidences.shipinhao!,
        },
      };
    }
    message.value = "三平台文案已生成并保存。";
    await loadRecord();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "E_UPSTREAM: 文案生成失败";
  } finally {
    busy.value = false;
    operationMessage.value = "";
    await loadRuntimeInfo();
  }
}

function canGenerate(): boolean {
  if (hasBudget.value) return true;
  errorMessage.value = "E_BUDGET_EXHAUSTED: 试用额度已用完，请稍后再试";
  return false;
}

function onImageChange(event: { detail: { current: number } }): void {
  currentImage.value = event.detail.current;
}

function confidence(
  field: "category" | "colors" | "style",
): number | undefined {
  return record.value?.recognize.confidence[field];
}

function isLow(field: "category" | "colors" | "style"): boolean {
  const value = confidence(field);
  return value !== undefined && value < 0.7;
}

function copyText(value: string): void {
  if (!value) return;
  uni.setClipboardData({
    data: value,
    success: () => uni.showToast({ title: "文案已复制", icon: "success" }),
  });
}

function money(value: number): string {
  return value.toFixed(2);
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function isDescriptionPlatform(value: unknown): value is DescriptionPlatform {
  return value === "douyin" || value === "xiaohongshu" || value === "shipinhao";
}
function parseEventJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
function isTextPayload(value: unknown): value is { text: string } {
  return isObject(value) && typeof value.text === "string";
}
function isVariantChunk(
  value: unknown,
): value is { platform: DescriptionPlatform; text: string } {
  return (
    isObject(value) &&
    isDescriptionPlatform(value.platform) &&
    typeof value.text === "string"
  );
}
function eventError(value: string): Error {
  const payload = parseEventJson(value);
  if (isObject(payload))
    return new Error(
      `${typeof payload.code === "string" ? payload.code : "E_UPSTREAM"}: ${typeof payload.message === "string" ? payload.message : "文案生成失败"}`,
    );
  return new Error(`E_UPSTREAM: ${value || "文案生成失败"}`);
}
function isRuntimeInfo(value: unknown): value is RuntimeInfo {
  return (
    isObject(value) &&
    typeof value.mock === "boolean" &&
    typeof value.priceConfigured === "boolean" &&
    isNonNegativeNumber(value.spentCny) &&
    isNonNegativeNumber(value.reservedCny) &&
    isNonNegativeNumber(value.pendingReconcile) &&
    isNonNegativeNumber(value.budget) &&
    isNonNegativeNumber(value.remainingCny)
  );
}
</script>

<template>
  <view class="page">
    <view class="topline">
      <text class="eyebrow">PRODUCT DETAIL · 03 / 03</text>
      <text v-if="runtimeInfo" class="budget"
        >剩余额度 ¥{{ money(runtimeInfo.remainingCny) }}</text
      >
    </view>
    <view v-if="errorMessage" class="notice error">{{ errorMessage }}</view>
    <view v-if="message" class="notice success">{{ message }}</view>
    <view v-if="loading && !record" class="state">正在读取商品详情…</view>
    <template v-else-if="record">
      <view class="card gallery-card">
        <swiper
          v-if="record.imageUrls.length"
          class="gallery"
          :current="currentImage"
          @change="onImageChange"
        >
          <swiper-item
            v-for="(image, index) in record.imageUrls"
            :key="`${record.images[index]}-${index}`"
          >
            <image
              class="gallery-image"
              :src="absoluteImageUrl(image)"
              mode="aspectFit"
            />
          </swiper-item>
        </swiper>
        <view class="gallery-count"
          >{{ currentImage + 1 }} / {{ record.imageUrls.length }}</view
        >
        <text class="record-title">{{ record.recognize.item_name }}</text>
      </view>

      <view class="card">
        <view class="section-heading"
          ><text>识别资料</text
          ><button v-if="!editing" class="small-button" @tap="editRecord">
            编辑资料
          </button></view
        >
        <template v-if="editing && recognizeDraft">
          <view class="edit-field"
            ><text>商品名</text
            ><input v-model="recognizeDraft.item_name" class="input"
          /></view>
          <view class="edit-field"
            ><text>品类</text
            ><picker
              :range="CATEGORIES"
              :value="CATEGORIES.indexOf(recognizeDraft.category)"
              @change="
                recognizeDraft.category =
                  CATEGORIES[Number($event.detail.value)] ??
                  recognizeDraft.category
              "
              ><view class="input picker"
                >{{ recognizeDraft.category }} <text>⌄</text></view
              ></picker
            ></view
          >
          <view class="edit-field"
            ><text>颜色（名称 | 色值，逗号分隔）</text
            ><input v-model="colorText" class="input" @blur="updateColors"
          /></view>
          <view class="edit-field"
            ><text>风格</text
            ><picker
              :range="STYLES"
              :value="STYLES.indexOf(recognizeDraft.style)"
              @change="
                recognizeDraft.style =
                  STYLES[Number($event.detail.value)] ?? recognizeDraft.style
              "
              ><view class="input picker"
                >{{ recognizeDraft.style }} <text>⌄</text></view
              ></picker
            ></view
          >
          <view class="edit-field"
            ><text>季节（用顿号分隔）</text
            ><input v-model="seasonText" class="input" @blur="updateSeasons"
          /></view>
          <view class="edit-field"
            ><text>适用人群</text
            ><picker
              :range="AUDIENCES"
              :value="AUDIENCES.indexOf(recognizeDraft.audience)"
              @change="
                recognizeDraft.audience =
                  AUDIENCES[Number($event.detail.value)] ??
                  recognizeDraft.audience
              "
              ><view class="input picker"
                >{{ recognizeDraft.audience }} <text>⌄</text></view
              ></picker
            ></view
          >
          <view class="edit-field"
            ><text>面料</text
            ><input v-model="recognizeDraft.fabric" class="input"
          /></view>
          <view class="edit-field"
            ><text>吊牌价建议（元）</text
            ><input
              :value="recognizeDraft.tagPrice ?? ''"
              class="input"
              type="digit"
              @input="updateTagPrice"
          /></view>
          <view class="sku-editor">
            <text class="field-heading">SKU 与价格</text>
            <view
              v-for="(sku, index) in skuDraft"
              :key="`${sku.color}-${sku.size}-${index}`"
              class="sku-row"
            >
              <text>{{ sku.color }} / {{ sku.size }}</text>
              <input
                v-model.number="skuDraft[index]!.stock"
                class="input"
                type="number"
                placeholder="库存"
              />
              <input
                v-model.number="skuDraft[index]!.tagPrice"
                class="input"
                type="digit"
                placeholder="吊牌价"
              />
              <input
                v-model.number="skuDraft[index]!.wholesalePrice"
                class="input"
                type="digit"
                placeholder="批发价"
              />
            </view>
          </view>
          <view class="actions"
            ><button class="small-button" :disabled="busy" @tap="cancelEdit">
              取消</button
            ><button
              class="small-button primary-button"
              :disabled="busy"
              @tap="saveEdit"
            >
              {{ busy ? "保存中…" : "保存修改" }}
            </button></view
          >
        </template>
        <template v-else>
          <view
            class="data-row"
            :class="{ 'low-confidence': isLow('category') }"
            ><text>商品品类</text><text>{{ record.recognize.category }}</text
            ><text v-if="isLow('category')" class="warning"
              >需人工确认 ·
              {{ Math.round((confidence("category") ?? 0) * 100) }}%</text
            ></view
          >
          <view class="data-row" :class="{ 'low-confidence': isLow('colors') }"
            ><text>主色调</text
            ><text>{{
              record.recognize.colors.map((item) => item.name).join("、")
            }}</text
            ><text v-if="isLow('colors')" class="warning"
              >需人工确认 ·
              {{ Math.round((confidence("colors") ?? 0) * 100) }}%</text
            ></view
          >
          <view class="data-row" :class="{ 'low-confidence': isLow('style') }"
            ><text>整体风格</text><text>{{ record.recognize.style }}</text
            ><text v-if="isLow('style')" class="warning"
              >需人工确认 ·
              {{ Math.round((confidence("style") ?? 0) * 100) }}%</text
            ></view
          >
          <view
            class="data-row"
            :class="{
              'low-confidence': record.recognize.confidence.overall < 0.7,
            }"
            ><text>整体置信度</text
            ><text
              >{{
                Math.round(record.recognize.confidence.overall * 100)
              }}%</text
            ><text
              v-if="record.recognize.confidence.overall < 0.7"
              class="warning"
              >需人工确认</text
            ></view
          >
          <view class="data-row"
            ><text>季节</text
            ><text>{{ record.recognize.seasons.join("、") }}</text></view
          >
          <view class="data-row"
            ><text>适用人群</text
            ><text>{{ record.recognize.audience }}</text></view
          >
          <view class="data-row"
            ><text>面料</text
            ><text>{{ record.recognize.fabric || "未识别" }}</text></view
          >
          <view
            v-for="(sku, index) in record.sku"
            :key="`${sku.color}-${sku.size}-${index}`"
            class="data-row sku-display"
            ><text>{{ sku.color }} / {{ sku.size }}</text
            ><text
              >库存 {{ sku.stock }} · 吊牌价 ¥{{ money(sku.tagPrice) }} · 批发价
              ¥{{ money(sku.wholesalePrice) }}</text
            ></view
          >
        </template>
      </view>

      <view class="card">
        <view class="section-heading"
          ><text>商品描述</text
          ><button
            class="small-button"
            :disabled="busy || editing || !hasBudget"
            @tap="generateDescription"
          >
            生成描述
          </button></view
        >
        <text v-if="operationMessage" class="operation">{{
          operationMessage
        }}</text>
        <text v-if="descriptionConfidence !== undefined" class="confidence"
          >描述置信度 {{ Math.round(descriptionConfidence * 100) }}%</text
        >
        <text
          class="copyable"
          selectable
          @longpress="
            copyText(
              descriptionText || record.descriptionAi || record.description,
            )
          "
          >{{
            descriptionText ||
            record.descriptionAi ||
            record.description ||
            "还没有生成描述"
          }}</text
        >
        <button
          v-if="descriptionText || record.descriptionAi || record.description"
          class="copy-button"
          @tap="
            copyText(
              descriptionText || record.descriptionAi || record.description,
            )
          "
        >
          复制描述
        </button>
      </view>

      <view class="card">
        <view class="section-heading"
          ><text>多平台文案</text
          ><button
            class="small-button"
            :disabled="busy || editing || !hasBudget"
            @tap="generateVariants"
          >
            生成三平台文案
          </button></view
        >
        <text class="hint"
          >三个平台会依次请求模型，完成后可切换查看和复制。</text
        >
        <text v-if="operationMessage" class="operation">{{
          operationMessage
        }}</text>
        <view class="platform-tabs"
          ><button
            v-for="platform in platforms"
            :key="platform"
            :class="{ active: activePlatform === platform }"
            @tap="activePlatform = platform"
          >
            {{ platformLabels[platform] }}
          </button></view
        >
        <text v-if="variantConfidence[activePlatform]" class="confidence"
          >置信度
          {{
            Math.round((variantConfidence[activePlatform]?.overall ?? 0) * 100)
          }}%</text
        >
        <text
          class="copyable"
          selectable
          @longpress="copyText(activeVariantText)"
          >{{ activeVariantText || "还没有生成该平台文案" }}</text
        >
        <button
          v-if="activeVariantText"
          class="copy-button"
          @tap="copyText(activeVariantText)"
        >
          复制当前文案
        </button>
      </view>
    </template>
    <view v-if="busy" class="blocking"
      ><view class="blocking-card"
        ><text class="spinner">···</text
        ><text>{{ operationMessage || "正在保存，请稍候…" }}</text
        ><text class="subtle"
          >请保持页面打开，完成后会自动保存结果。</text
        ></view
      ></view
    >
  </view>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  padding-bottom: var(--space-6);
}
.topline,
.section-heading,
.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.eyebrow {
  color: var(--c-primary);
  font-family: var(--font-mono);
  font-size: var(--font-xs);
  letter-spacing: 2rpx;
}
.budget {
  color: var(--c-success);
  font-family: var(--font-mono);
  font-size: var(--font-xs);
}
.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1rpx solid var(--c-border);
  border-radius: var(--radius-tag);
  background: var(--c-surface);
}
.gallery-card {
  position: relative;
  padding: var(--space-2);
}
.gallery {
  width: 100%;
  height: 520rpx;
  border-radius: var(--radius);
  background: var(--c-bg);
}
.gallery-image {
  width: 100%;
  height: 100%;
}
.gallery-count {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-full);
  background: var(--c-ink);
  color: var(--c-surface);
  font-size: var(--font-xs);
}
.record-title {
  padding: var(--space-2);
  color: var(--c-ink);
  font-family: var(--font-heading);
  font-size: var(--font-lg);
  font-weight: 600;
}
.section-heading {
  color: var(--c-ink);
  font-size: var(--font-lg);
  font-weight: 600;
}
.small-button,
.copy-button {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border: 1rpx solid var(--c-primary);
  border-radius: var(--radius);
  background: var(--c-surface);
  color: var(--c-primary);
  font-size: var(--font-xs);
  line-height: 1.5;
}
.primary-button {
  background: var(--c-primary);
  color: var(--c-surface);
}
.data-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) 0;
  border-bottom: 1rpx solid var(--c-border);
  color: var(--c-ink);
  font-size: var(--font-sm);
}
.data-row > text:first-child {
  color: var(--c-ink-2);
}
.low-confidence {
  padding: var(--space-2);
  border-radius: var(--radius);
  background: var(--c-warn-bg);
  color: var(--c-warn-ink);
}
.warning {
  flex-basis: 100%;
  color: var(--c-warn-ink);
  font-size: var(--font-xs);
}
.edit-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  color: var(--c-ink-2);
  font-size: var(--font-xs);
}
.input {
  box-sizing: border-box;
  width: 100%;
  min-height: 76rpx;
  padding: var(--space-2) var(--space-3);
  border: 1rpx solid var(--c-border);
  border-radius: var(--radius);
  background: var(--c-surface);
  color: var(--c-ink);
  font-size: var(--font-sm);
}
.picker {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sku-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.field-heading {
  color: var(--c-ink);
  font-size: var(--font-sm);
  font-weight: 600;
}
.sku-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1rpx solid var(--c-border);
  color: var(--c-ink);
  font-size: var(--font-xs);
}
.sku-row > text {
  grid-column: 1 / -1;
}
.sku-display {
  font-size: var(--font-xs);
}
.copyable {
  color: var(--c-ink);
  font-size: var(--font-sm);
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.hint,
.confidence {
  color: var(--c-ink-2);
  font-size: var(--font-xs);
}
.platform-tabs {
  display: flex;
  gap: var(--space-2);
  border-bottom: 1rpx solid var(--c-border);
}
.platform-tabs button {
  flex: 1;
  margin: 0;
  padding: var(--space-2);
  border: 0;
  border-bottom: 4rpx solid transparent;
  background: transparent;
  color: var(--c-ink-2);
  font-size: var(--font-xs);
}
.platform-tabs button.active {
  border-bottom-color: var(--c-primary);
  color: var(--c-primary);
}
.operation {
  padding: var(--space-2);
  background: var(--c-warn-bg);
  color: var(--c-warn-ink);
  font-size: var(--font-xs);
  line-height: 1.5;
}
.notice {
  padding: var(--space-3);
  border-left: 6rpx solid;
  border-radius: var(--radius);
  background: var(--c-surface);
  font-size: var(--font-sm);
  line-height: 1.5;
}
.error {
  border-color: var(--c-error);
  color: var(--c-error);
}
.success {
  border-color: var(--c-success);
  color: var(--c-success);
}
.state {
  display: flex;
  min-height: 260rpx;
  align-items: center;
  justify-content: center;
  color: var(--c-ink-2);
  font-size: var(--font-sm);
}
.blocking {
  position: fixed;
  z-index: 10;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-5);
  background: var(--c-ink);
  opacity: 0.96;
}
.blocking-card {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-5);
  border-radius: var(--radius-tag);
  background: var(--c-surface);
  color: var(--c-ink);
  text-align: center;
  font-size: var(--font-sm);
}
.spinner {
  color: var(--c-primary);
  font-size: var(--font-xl);
  font-weight: 700;
  letter-spacing: 4rpx;
}
.subtle {
  color: var(--c-ink-2);
  font-size: var(--font-xs);
}
</style>
