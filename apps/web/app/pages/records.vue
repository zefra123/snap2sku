<script setup lang="ts">
import { computed, onMounted, ref, toRaw } from "vue";
import { apiFetch, apiStream } from "../utils/api";
import {
  AUDIENCES,
  CATEGORIES,
  DescriptionSourceSchema,
  DescribeResultSchema,
  PLACEHOLDER_ITEM_NAME,
  ProductRecordWithImageUrlsSchema,
  RECOGNIZE_FIELD_NAMES,
  RecognizeResultSchema,
  SEASONS,
  SKUItemSchema,
  STYLES,
  type DescribeResult,
  type ProductRecord,
  type ProductRecordWithImageUrls,
  type RecognizeResult,
  type SKUItem,
} from "@scope/shared/schema";

const records = ref<ProductRecordWithImageUrls[]>([]);
const totalCostEstimate = computed(() =>
  records.value.reduce((total, record) => total + record.costEstimate, 0),
);
const loading = ref(true);
const errorMessage = ref("");
const expandedIds = ref(new Set<string>());
const descriptionOutputs = ref<Record<string, string>>({});
const variantOutputs = ref<
  Record<
    string,
    Partial<Record<"douyin" | "xiaohongshu" | "shipinhao", string>>
  >
>({});
const activePlatforms = ref<
  Record<string, "douyin" | "xiaohongshu" | "shipinhao">
>({});
const descriptionErrors = ref<Record<string, string>>({});
const descriptionNotices = ref<Record<string, string>>({});
const descriptionConfidences = ref<Record<string, number>>({});
const generatingIds = ref(new Set<string>());
const generationControllers = ref<Record<string, AbortController>>({});
const editDrafts = ref<
  Record<
    string,
    { detailsVersion: number; recognize: RecognizeResult; sku: SKUItem[] }
  >
>({});
const savingIds = ref(new Set<string>());
const editErrors = ref<Record<string, string>>({});

type RecognizeFieldKey = Exclude<keyof RecognizeResult, "confidence">;
const recognizeFieldLabels: Record<RecognizeFieldKey, string> = {
  category: "商品品类",
  colors: "主色调",
  style: "整体风格",
  seasons: "适穿季节",
  audience: "目标人群",
  fabric: "面料",
  tagPrice: "建议吊牌价",
  item_name: "商品命名建议",
};

onMounted(loadRecords);

function formatCost(value: number): string {
  return value.toFixed(6);
}

async function loadRecords(): Promise<void> {
  loading.value = true;
  errorMessage.value = "";
  try {
    records.value = ProductRecordWithImageUrlsSchema.array().parse(
      await apiFetch<unknown>("/api/records"),
    );
  } catch {
    errorMessage.value = "记录暂时无法读取，请刷新页面重试。";
  } finally {
    loading.value = false;
  }
}

async function generateDescription(record: ProductRecord): Promise<void> {
  descriptionNotices.value = { ...descriptionNotices.value, [record.id]: "" };
  descriptionOutputs.value = { ...descriptionOutputs.value, [record.id]: "" };
  descriptionErrors.value = { ...descriptionErrors.value, [record.id]: "" };
  const nextConfidences = { ...descriptionConfidences.value };
  delete nextConfidences[record.id];
  descriptionConfidences.value = nextConfidences;
  generatingIds.value = new Set(generatingIds.value).add(record.id);
  const controller = new AbortController();
  generationControllers.value = {
    ...generationControllers.value,
    [record.id]: controller,
  };
  let receivedDone = false;
  let pendingConfidence: number | undefined;
  let pendingCostEstimate: number | undefined;

  try {
    const response = await apiStream(
      `/api/records/${encodeURIComponent(record.id)}/describe`,
      {
        method: "POST",
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      descriptionErrors.value = {
        ...descriptionErrors.value,
        [record.id]: await responseErrorMessage(response),
      };
      return;
    }
    if (!response.body) throw new Error("浏览器无法读取描述生成流");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (!receivedDone) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = await consumeDescriptionEvents(
        buffer,
        record.id,
        (doneEvent) => {
          receivedDone = doneEvent;
        },
        (confidence) => {
          pendingConfidence = confidence;
        },
        (costEstimate) => {
          pendingCostEstimate = costEstimate;
        },
      );
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      await consumeDescriptionEvents(
        `${buffer}\n\n`,
        record.id,
        (doneEvent) => {
          receivedDone = doneEvent;
        },
        (confidence) => {
          pendingConfidence = confidence;
        },
        (costEstimate) => {
          pendingCostEstimate = costEstimate;
        },
      );
    }

    if (!receivedDone) {
      descriptionErrors.value = {
        ...descriptionErrors.value,
        [record.id]: "描述未保存，请重新生成",
      };
    } else {
      record.descriptionAi = descriptionOutputs.value[record.id] ?? "";
      if (pendingCostEstimate !== undefined) {
        record.costEstimate = pendingCostEstimate;
      }
      if (pendingConfidence !== undefined) {
        descriptionConfidences.value = {
          ...descriptionConfidences.value,
          [record.id]: pendingConfidence,
        };
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      descriptionErrors.value = {
        ...descriptionErrors.value,
        [record.id]: readGenerationError(error),
      };
    }
  } finally {
    if (generationControllers.value[record.id] === controller) {
      const controllers = { ...generationControllers.value };
      delete controllers[record.id];
      generationControllers.value = controllers;
    }
    const next = new Set(generatingIds.value);
    next.delete(record.id);
    generatingIds.value = next;
  }
}

async function generateVariants(record: ProductRecord): Promise<void> {
  descriptionNotices.value = { ...descriptionNotices.value, [record.id]: "" };
  const outputs: Partial<
    Record<"douyin" | "xiaohongshu" | "shipinhao", string>
  > = {};
  variantOutputs.value = { ...variantOutputs.value, [record.id]: outputs };
  generatingIds.value = new Set(generatingIds.value).add(record.id);
  const controller = new AbortController();
  generationControllers.value = {
    ...generationControllers.value,
    [record.id]: controller,
  };
  let receivedDone = false;
  let pendingCostEstimate: number | undefined;
  const confidences: Partial<
    Record<"douyin" | "xiaohongshu" | "shipinhao", DescribeResult["confidence"]>
  > = {};
  try {
    const response = await apiStream(
      `/api/records/${encodeURIComponent(record.id)}/describe-variants`,
      { method: "POST", signal: controller.signal },
    );
    if (!response.ok) {
      descriptionErrors.value = {
        ...descriptionErrors.value,
        [record.id]: await responseErrorMessage(response),
      };
      return;
    }
    if (!response.body) throw new Error("浏览器无法读取描述生成流");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!receivedDone) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = consumeVariantEvents(
        buffer,
        record.id,
        outputs,
        confidences,
        (doneEvent) => {
          receivedDone = doneEvent;
        },
        (cost) => {
          pendingCostEstimate = cost;
        },
      );
    }
    buffer += decoder.decode();
    if (buffer.trim())
      consumeVariantEvents(
        `${buffer}\n\n`,
        record.id,
        outputs,
        confidences,
        (doneEvent) => {
          receivedDone = doneEvent;
        },
        (cost) => {
          pendingCostEstimate = cost;
        },
      );
    if (!receivedDone)
      descriptionErrors.value = {
        ...descriptionErrors.value,
        [record.id]: "描述未保存，请重新生成",
      };
    else {
      record.descriptionVariantsAi = {
        douyin: {
          description: outputs.douyin ?? "",
          confidence: confidences.douyin!,
        },
        xiaohongshu: {
          description: outputs.xiaohongshu ?? "",
          confidence: confidences.xiaohongshu!,
        },
        shipinhao: {
          description: outputs.shipinhao ?? "",
          confidence: confidences.shipinhao!,
        },
      };
      if (pendingCostEstimate !== undefined)
        record.costEstimate = pendingCostEstimate;
    }
  } catch (error) {
    if (!controller.signal.aborted)
      descriptionErrors.value = {
        ...descriptionErrors.value,
        [record.id]: readGenerationError(error),
      };
  } finally {
    if (generationControllers.value[record.id] === controller) {
      const controllers = { ...generationControllers.value };
      delete controllers[record.id];
      generationControllers.value = controllers;
    }
    const next = new Set(generatingIds.value);
    next.delete(record.id);
    generatingIds.value = next;
  }
}

function consumeVariantEvents(
  source: string,
  recordId: string,
  outputs: Partial<Record<"douyin" | "xiaohongshu" | "shipinhao", string>>,
  confidences: Partial<
    Record<"douyin" | "xiaohongshu" | "shipinhao", DescribeResult["confidence"]>
  >,
  setDone: (done: boolean) => void,
  setCostEstimate: (cost: number) => void,
): string {
  let remainder = source.replaceAll("\r\n", "\n");
  let boundary = remainder.indexOf("\n\n");
  while (boundary !== -1) {
    const block = remainder.slice(0, boundary);
    remainder = remainder.slice(boundary + 2);
    const eventName = block
      .split("\n")
      .find((line) => line.startsWith("event: "))
      ?.slice(7);
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6))
      .join("\n");
    if (eventName === "chunk") {
      const payload: unknown = JSON.parse(data);
      if (
        typeof payload === "object" &&
        payload !== null &&
        "platform" in payload &&
        "text" in payload &&
        typeof payload.platform === "string" &&
        ["douyin", "xiaohongshu", "shipinhao"].includes(payload.platform) &&
        typeof payload.text === "string"
      ) {
        const platform = payload.platform as
          "douyin" | "xiaohongshu" | "shipinhao";
        outputs[platform] = `${outputs[platform] ?? ""}${payload.text}`;
        variantOutputs.value = {
          ...variantOutputs.value,
          [recordId]: { ...outputs },
        };
      }
    } else if (eventName === "error") throw new Error(data);
    else if (eventName === "result") {
      const payload: unknown = JSON.parse(data);
      if (typeof payload === "object" && payload !== null) {
        if (
          "platform" in payload &&
          typeof payload.platform === "string" &&
          ["douyin", "xiaohongshu", "shipinhao"].includes(payload.platform) &&
          "confidence" in payload
        ) {
          const parsed = DescribeResultSchema.shape.confidence.safeParse(
            payload.confidence,
          );
          if (parsed.success)
            confidences[
              payload.platform as "douyin" | "xiaohongshu" | "shipinhao"
            ] = parsed.data;
        }
        if (
          "costEstimate" in payload &&
          typeof payload.costEstimate === "number" &&
          Number.isFinite(payload.costEstimate) &&
          payload.costEstimate >= 0
        )
          setCostEstimate(payload.costEstimate);
      }
    } else if (eventName === "done" && data === "[DONE]") setDone(true);
    boundary = remainder.indexOf("\n\n");
  }
  return remainder;
}

async function consumeDescriptionEvents(
  source: string,
  recordId: string,
  setDone: (done: boolean) => void,
  setConfidence: (confidence: number) => void,
  setCostEstimate: (costEstimate: number) => void,
): Promise<string> {
  let remainder = source.replaceAll("\r\n", "\n");
  let boundary = remainder.indexOf("\n\n");
  while (boundary !== -1) {
    const block = remainder.slice(0, boundary);
    remainder = remainder.slice(boundary + 2);
    const eventName = block
      .split("\n")
      .find((line) => line.startsWith("event: "))
      ?.slice(7);
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6))
      .join("\n");

    if (eventName === "chunk") {
      const payload: unknown = JSON.parse(data);
      if (isDescriptionChunk(payload)) {
        descriptionOutputs.value = {
          ...descriptionOutputs.value,
          [recordId]: `${descriptionOutputs.value[recordId] ?? ""}${payload.text}`,
        };
      }
    } else if (eventName === "error") {
      throw new Error(data);
    } else if (eventName === "result") {
      const payload: unknown = JSON.parse(data);
      if (typeof payload === "object" && payload !== null) {
        if ("confidence" in payload) {
          const parsed = DescribeResultSchema.shape.confidence.safeParse(
            payload.confidence,
          );
          if (parsed.success) setConfidence(parsed.data.description);
        }
        if (
          "costEstimate" in payload &&
          typeof payload.costEstimate === "number" &&
          Number.isFinite(payload.costEstimate) &&
          payload.costEstimate >= 0
        ) {
          setCostEstimate(payload.costEstimate);
        }
      }
    } else if (eventName === "done" && data === "[DONE]") {
      setDone(true);
    }

    boundary = remainder.indexOf("\n\n");
  }
  return remainder;
}

function isDescriptionChunk(value: unknown): value is { text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof value.text === "string"
  );
}

function confidenceTickCount(confidence: number): number {
  return Math.max(1, Math.min(5, Math.round(confidence * 5)));
}

function readGenerationError(error: unknown): string {
  if (error instanceof Error) {
    try {
      const payload: unknown = JSON.parse(error.message);
      if (typeof payload === "object" && payload !== null) {
        const code = "code" in payload && typeof payload.code === "string"
          ? payload.code
          : "E_WRITE_FAILED";
        const message = "message" in payload && typeof payload.message === "string"
          ? payload.message
          : "描述保存失败，请稍后重试";
        return `${code}：${message}`;
      }
    } catch {
      return error.message || "描述未保存，请重新生成";
    }
  }
  return "描述未保存，请重新生成";
}

async function responseErrorMessage(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (typeof payload === "object" && payload !== null && "data" in payload) {
      const data = payload.data;
      if (
        typeof data === "object" &&
        data !== null &&
        "message" in data &&
        typeof data.message === "string"
      ) {
        return data.message;
      }
    }
  } catch {
    // 响应体不是 JSON 时使用状态码兜底。
  }
  if (response.status === 401) return "访问码缺失或不正确，请检查后重试。";
  if (response.status === 404) return "找不到这条商品记录，请刷新页面后重试。";
  return `描述生成失败（HTTP ${response.status}），请稍后重试。`;
}

function toggleRecord(id: string): void {
  const next = new Set(expandedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedIds.value = next;
}

function beginEdit(record: ProductRecord): void {
  const snapshot = structuredClone(toRaw(record));
  editDrafts.value = {
    ...editDrafts.value,
    [record.id]: {
      detailsVersion: snapshot.detailsVersion,
      recognize: snapshot.recognize,
      sku: snapshot.sku,
    },
  };
  editErrors.value = { ...editErrors.value, [record.id]: "" };
}

function cancelEdit(recordId: string): void {
  const next = { ...editDrafts.value };
  delete next[recordId];
  editDrafts.value = next;
  editErrors.value = { ...editErrors.value, [recordId]: "" };
}

function colorEditorValue(recordId: string): string {
  return (editDrafts.value[recordId]?.recognize.colors ?? [])
    .map((color) => `${color.name} | ${color.hex}`)
    .join(", ");
}

function updateDraftColors(recordId: string, event: Event): void {
  const draft = editDrafts.value[recordId];
  if (!draft) return;
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  draft.recognize.colors = input.value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [name = "", hex = ""] = item.split("|").map((part) => part.trim());
      return { name, hex };
    });
}

function updateDraftTagPrice(recordId: string, event: Event): void {
  const draft = editDrafts.value[recordId];
  const input = event.target;
  if (!draft || !(input instanceof HTMLInputElement)) return;
  draft.recognize.tagPrice = input.value === "" ? null : Number(input.value);
}

async function saveEdit(record: ProductRecord): Promise<void> {
  const draft = editDrafts.value[record.id];
  if (!draft) return;
  const recognize = RecognizeResultSchema.safeParse(draft.recognize);
  const sku = SKUItemSchema.array().min(1).safeParse(draft.sku);
  if (!recognize.success || !sku.success) {
    editErrors.value = {
      ...editErrors.value,
      [record.id]: "E_VALIDATION：请检查商品字段、颜色格式和 SKU 价格。",
    };
    return;
  }
  savingIds.value = new Set(savingIds.value).add(record.id);
  editErrors.value = { ...editErrors.value, [record.id]: "" };
  const sourceChanged =
    JSON.stringify(DescriptionSourceSchema.parse(record.recognize)) !==
    JSON.stringify(DescriptionSourceSchema.parse(recognize.data));
  try {
    const updated = await apiFetch<ProductRecord>(
      `/api/records/${encodeURIComponent(record.id)}`,
      {
        method: "PUT",
        body: {
          detailsVersion: draft.detailsVersion,
          recognize: recognize.data,
          sku: sku.data,
        },
      },
    );
    records.value = records.value.map((item) =>
      item.id === record.id ? { ...updated, imageUrls: item.imageUrls } : item,
    );
    if (sourceChanged) {
      generationControllers.value[record.id]?.abort();
      const nextDescriptionOutputs = { ...descriptionOutputs.value };
      delete nextDescriptionOutputs[record.id];
      descriptionOutputs.value = nextDescriptionOutputs;
      const nextVariantOutputs = { ...variantOutputs.value };
      delete nextVariantOutputs[record.id];
      variantOutputs.value = nextVariantOutputs;
      const nextConfidences = { ...descriptionConfidences.value };
      delete nextConfidences[record.id];
      descriptionConfidences.value = nextConfidences;
      descriptionErrors.value = { ...descriptionErrors.value, [record.id]: "" };
      descriptionNotices.value = {
        ...descriptionNotices.value,
        [record.id]: "商品资料已更新，AI 文案已清空，请手动重新生成。",
      };
    }
    cancelEdit(record.id);
  } catch (error) {
    editErrors.value = {
      ...editErrors.value,
      [record.id]: editFailureMessage(error),
    };
  } finally {
    const next = new Set(savingIds.value);
    next.delete(record.id);
    savingIds.value = next;
  }
}

function editFailureMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "data" in error) {
    const payload = error.data;
    if (typeof payload === "object" && payload !== null) {
      const data = "data" in payload ? payload.data : payload;
      if (typeof data === "object" && data !== null) {
        const code =
          "code" in data && typeof data.code === "string"
            ? data.code
            : undefined;
        const message =
          "message" in data && typeof data.message === "string"
            ? data.message
            : undefined;
        if (code && message) return `${code}：${message}`;
      }
    }
  }
  return "E_UPSTREAM：保存失败，请检查网络或访问码后重试。";
}

function elapsedMs(record: ProductRecord): number {
  return Math.max(
    0,
    record.durationMs.submittedAt - record.durationMs.uploadStart,
  );
}

function formatDuration(record: ProductRecord): string {
  const seconds = Math.floor(elapsedMs(record) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "未填写";
  if (Array.isArray(value)) return value.map(formatValue).join("、");
  if (typeof value === "object") {
    if ("name" in value && typeof value.name === "string") {
      return "hex" in value && typeof value.hex === "string"
        ? `${value.name} (${value.hex})`
        : value.name;
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function isPlaceholderName(name: string): boolean {
  return name === PLACEHOLDER_ITEM_NAME;
}

function terminalFields(
  record: ProductRecord,
): Array<{ key: RecognizeFieldKey; label: string; value: string }> {
  return RECOGNIZE_FIELD_NAMES.filter(
    (field): field is RecognizeFieldKey => field !== "confidence",
  ).map((key) => ({
    key,
    label: recognizeFieldLabels[key],
    value: formatValue(record.recognize[key]),
  }));
}

function editLabel(field: string): string {
  const skuEdit = /^sku:(.+)\/(.+):(stock|tagPrice|wholesalePrice)$/.exec(
    field,
  );
  if (skuEdit) {
    const detail = {
      stock: "库存",
      tagPrice: "吊牌价",
      wholesalePrice: "批发单价",
    }[skuEdit[3] as "stock" | "tagPrice" | "wholesalePrice"];
    return `${skuEdit[1]} / ${skuEdit[2]} ${detail}`;
  }
  const key = RECOGNIZE_FIELD_NAMES.find((candidate) => candidate === field);
  return key && key !== "confidence" ? recognizeFieldLabels[key] : field;
}

function editValue(value: unknown): string {
  return formatValue(value);
}
</script>

<template>
  <div class="records-page">
    <AppHeader
      status-text="本地记录"
      :cost-text="`累计估算 ¥${formatCost(totalCostEstimate)}`"
    />

    <main class="records-main">
      <div class="records-page-heading">
        <div>
          <span class="eyebrow">PRODUCT RECORDS · 02 / 03</span>
          <h1>每一件，都有据可查。</h1>
          <p>已确认的商品终值与人工修正记录。</p>
        </div>
        <NuxtLink class="new-record-link" to="/">＋ 新建商品</NuxtLink>
      </div>

      <p v-if="errorMessage" class="records-alert" role="alert">
        {{ errorMessage }}
      </p>
      <div v-if="loading" class="records-state" role="status">
        正在读取本地记录…
      </div>
      <div
        v-else-if="!records.length"
        class="records-state records-state--empty"
      >
        <span class="empty-mark">▤</span><strong>还没有商品记录</strong
        ><span>完成一件商品录入后，记录会显示在这里。</span
        ><NuxtLink to="/">前往录入工作台 →</NuxtLink>
      </div>

      <section v-else class="records-table-wrap" aria-label="商品记录列表">
        <div class="records-table-head" role="row">
          <span>照片</span><span>商品 / 品类 · 颜色</span><span>SKU 数</span
          ><span>耗时</span><span>成本</span><span>人工修正</span>
        </div>
        <div v-for="record in records" :key="record.id" class="record-group">
          <button
            class="record-list-row"
            type="button"
            :aria-expanded="expandedIds.has(record.id)"
            @click="toggleRecord(record.id)"
          >
            <span class="record-thumbnail"
              ><img
                v-if="record.images[0]"
                :src="record.imageUrls[0]"
                alt="商品缩略图"
              /><span v-else>—</span></span
            >
            <span class="record-product"
              ><strong
                :class="{
                  'is-placeholder': isPlaceholderName(
                    record.recognize.item_name,
                  ),
                }"
                >{{ record.recognize.item_name }}</strong
              ><span
                v-if="isPlaceholderName(record.recognize.item_name)"
                class="placeholder-tag"
                >AI 未命名</span
              ><small
                >{{ record.recognize.category }} ·
                {{
                  record.recognize.colors.map((color) => color.name).join(" / ")
                }}</small
              ></span
            >
            <span class="record-metric">{{ record.sku.length }}</span>
            <span class="record-metric">{{ formatDuration(record) }}</span>
            <span class="record-metric"
              >¥{{ record.costEstimate.toFixed(6) }}</span
            >
            <span class="record-edit-count">{{
              record.edits.length ? `${record.edits.length} 项已改` : "无修改"
            }}</span>
          </button>
          <section
            v-if="expandedIds.has(record.id)"
            class="record-ticket"
            aria-label="已确认的商品终值"
          >
            <div class="ticket-heading">
              <span>FINAL PRODUCT VALUES</span>
              <div class="ticket-heading-actions">
                <b>{{
                  record.edits.length ? "已保存人工修正" : "已确认为人工终值"
                }}</b
                ><button
                  v-if="!editDrafts[record.id]"
                  class="describe-button"
                  type="button"
                  @click.stop="beginEdit(record)"
                >
                  编辑资料
                </button>
              </div>
            </div>
            <dl class="terminal-fields">
              <div v-for="field in terminalFields(record)" :key="field.key">
                <dt>{{ field.label }}</dt>
                <dd>{{ field.value }}</dd>
              </div>
            </dl>
            <section
              v-if="editDrafts[record.id]"
              class="record-editor"
              aria-label="编辑商品资料"
            >
              <strong>修正商品资料</strong>
              <div class="record-editor-grid">
                <label
                  >商品品类<select
                    v-model="editDrafts[record.id]!.recognize.category"
                  >
                    <option
                      v-for="item in CATEGORIES"
                      :key="item"
                      :value="item"
                    >
                      {{ item }}
                    </option>
                  </select></label
                >
                <label
                  >整体风格<select
                    v-model="editDrafts[record.id]!.recognize.style"
                  >
                    <option v-for="item in STYLES" :key="item" :value="item">
                      {{ item }}
                    </option>
                  </select></label
                >
                <label
                  >目标人群<select
                    v-model="editDrafts[record.id]!.recognize.audience"
                  >
                    <option v-for="item in AUDIENCES" :key="item" :value="item">
                      {{ item }}
                    </option>
                  </select></label
                >
                <label
                  >面料<input
                    v-model="editDrafts[record.id]!.recognize.fabric"
                    type="text"
                    placeholder="可留空"
                /></label>
                <label
                  >建议吊牌价（元）<input
                    :value="editDrafts[record.id]!.recognize.tagPrice ?? ''"
                    type="number"
                    min="0.01"
                    step="0.01"
                    @input="updateDraftTagPrice(record.id, $event)"
                /></label>
                <label
                  >商品命名建议<input
                    v-model="editDrafts[record.id]!.recognize.item_name"
                    type="text"
                    maxlength="16"
                /></label>
                <label class="record-editor-wide"
                  >主色调（颜色名 | 色值，多个用逗号分隔）<input
                    :value="colorEditorValue(record.id)"
                    type="text"
                    placeholder="藏青 | #263A55"
                    @input="updateDraftColors(record.id, $event)"
                /></label>
                <fieldset class="record-editor-wide">
                  <legend>适穿季节</legend>
                  <label
                    v-for="item in SEASONS"
                    :key="item"
                    class="season-choice"
                    ><input
                      v-model="editDrafts[record.id]!.recognize.seasons"
                      type="checkbox"
                      :value="item"
                    />{{ item }}</label
                  >
                </fieldset>
              </div>
              <div class="sku-editor">
                <strong>SKU 库存与价格</strong>
                <div
                  v-for="(item, index) in editDrafts[record.id]!.sku"
                  :key="`${item.color}-${item.size}`"
                  class="sku-editor-row"
                >
                  <span>{{ item.color }} / {{ item.size }}</span
                  ><label
                    >库存<input
                      v-model.number="editDrafts[record.id]!.sku[index]!.stock"
                      type="number"
                      min="0"
                      step="1" /></label
                  ><label
                    >吊牌价（元）<input
                      v-model.number="
                        editDrafts[record.id]!.sku[index]!.tagPrice
                      "
                      type="number"
                      min="0.01"
                      step="0.01" /></label
                  ><label
                    >批发单价（元）<input
                      v-model.number="
                        editDrafts[record.id]!.sku[index]!.wholesalePrice
                      "
                      type="number"
                      min="0.01"
                      step="0.01"
                  /></label>
                </div>
              </div>
              <p
                v-if="editErrors[record.id]"
                class="description-error"
                role="alert"
              >
                {{ editErrors[record.id] }}
              </p>
              <div class="record-editor-actions">
                <button
                  class="describe-button"
                  type="button"
                  :disabled="savingIds.has(record.id)"
                  @click="cancelEdit(record.id)"
                >
                  取消</button
                ><button
                  class="describe-button describe-button--primary"
                  type="button"
                  :disabled="savingIds.has(record.id)"
                  @click="saveEdit(record)"
                >
                  {{ savingIds.has(record.id) ? "保存中…" : "保存修改" }}
                </button>
              </div>
            </section>
            <div class="ticket-description">
              <div class="ticket-description-heading">
                <strong>多平台商品描述</strong>
                <div class="description-actions">
                  <button
                    class="describe-button"
                    type="button"
                    :disabled="generatingIds.has(record.id)"
                    @click="generateDescription(record)"
                  >
                    生成通用描述</button
                  ><button
                    class="describe-button"
                    type="button"
                    :disabled="generatingIds.has(record.id)"
                    @click="generateVariants(record)"
                  >
                    {{
                      generatingIds.has(record.id)
                        ? "生成中…"
                        : "生成三平台文案"
                    }}
                  </button>
                </div>
              </div>
              <p
                v-if="descriptionNotices[record.id]"
                class="description-notice"
                role="status"
              >
                {{ descriptionNotices[record.id] }}
              </p>
              <div class="platform-tabs" role="tablist" aria-label="文案平台">
                <button
                  v-for="platform in [
                    { key: 'douyin', label: '抖音' },
                    { key: 'xiaohongshu', label: '小红书' },
                    { key: 'shipinhao', label: '视频号' },
                  ]"
                  :key="platform.key"
                  type="button"
                  role="tab"
                  :aria-selected="
                    (activePlatforms[record.id] ?? 'douyin') === platform.key
                  "
                  @click="
                    activePlatforms[record.id] = platform.key as
                      'douyin' | 'xiaohongshu' | 'shipinhao'
                  "
                >
                  {{ platform.label }}
                </button>
              </div>
              <p>
                {{
                  (variantOutputs[record.id]?.[
                    activePlatforms[record.id] ?? "douyin"
                  ] ??
                    record.descriptionVariantsAi?.[
                      activePlatforms[record.id] ?? "douyin"
                    ]?.description ??
                    descriptionOutputs[record.id] ??
                    record.descriptionAi ??
                    record.description) ||
                  "未填写"
                }}<i
                  v-if="generatingIds.has(record.id)"
                  class="typing-caret"
                  aria-label="正在生成"
                />
              </p>
              <div
                v-if="
                  !generatingIds.has(record.id) &&
                  descriptionConfidences[record.id] !== undefined
                "
                class="description-confidence"
              >
                <span>AI 描述置信度</span>
                <span
                  class="confidence-scale"
                  :class="{
                    'confidence-scale--low':
                      confidenceTickCount(descriptionConfidences[record.id]!) <
                      3,
                  }"
                  :aria-label="`置信度 ${confidenceTickCount(descriptionConfidences[record.id]!)} / 5`"
                  role="img"
                  ><i
                    v-for="tick in 5"
                    :key="tick"
                    :class="{
                      'confidence-tick--filled':
                        tick <=
                        confidenceTickCount(descriptionConfidences[record.id]!),
                    }"
                /></span>
                <small>模型自评</small>
                <b
                  >{{
                    Math.round(descriptionConfidences[record.id]! * 100)
                  }}%</b
                >
              </div>
              <span
                v-if="descriptionErrors[record.id]"
                class="description-error"
                role="alert"
                >{{ descriptionErrors[record.id] }}</span
              >
            </div>
            <div class="ticket-skus">
              <strong>SKU 规格</strong
              ><span>{{
                record.sku
                  .map(
                    (sku) =>
                      `${sku.color} / ${sku.size}：库存 ${sku.stock}，吊牌价 ¥${sku.tagPrice}，批发价 ¥${sku.wholesalePrice}`,
                  )
                  .join("；")
              }}</span>
            </div>
            <div v-if="record.edits.length" class="edits-flow">
              <strong>人工修正流水</strong>
              <div
                v-for="(edit, index) in record.edits"
                :key="`${record.id}-${edit.field}-${index}`"
                class="edit-flow-row"
              >
                <span>{{ editLabel(edit.field) }}</span
                ><code
                  >{{ editValue(edit.from) }} → {{ editValue(edit.to) }}</code
                >
              </div>
            </div>
            <p v-else class="no-edits">无人工修正。</p>
          </section>
        </div>
      </section>

      <footer class="records-footer">
        <span>snap2sku · 本地演示数据</span
        ><NuxtLink to="/">返回录入工作台</NuxtLink>
      </footer>
    </main>
  </div>
</template>

<style>
.records-page {
  min-height: 100vh;
}
.records-main {
  width: min(1160px, calc(100% - 64px));
  margin: 0 auto;
}
.records-page-heading {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 20px;
  padding: 38px 0 26px;
}
.records-page-heading .eyebrow {
  color: var(--c-ink-2);
  font-family: var(--font-mono);
  font-size: var(--font-xs);
  letter-spacing: 0.1em;
}
.records-page-heading h1 {
  margin: 12px 0 6px;
  font-family: var(--font-heading);
  font-size: var(--font-xl);
  font-weight: 600;
}
.records-page-heading p {
  margin: 0;
  color: var(--c-ink-2);
  font-size: var(--font-sm);
}
.new-record-link {
  padding: 9px 12px;
  border: 1px solid var(--c-primary);
  color: var(--c-primary);
  font-size: var(--font-xs);
  text-decoration: none;
  white-space: nowrap;
}
.records-table-wrap {
  border: 1px solid var(--c-border);
  background: var(--c-surface);
}
.records-table-head,
.record-list-row {
  display: grid;
  grid-template-columns: 52px minmax(180px, 1fr) 72px 92px 96px 92px;
  align-items: center;
  gap: 12px;
}
.records-table-head {
  min-height: 38px;
  padding: 0 14px;
  background: var(--c-bg);
  color: var(--c-ink-2);
  font-family: var(--font-mono);
  font-size: var(--font-xs);
}
.record-group {
  border-top: 1px solid var(--c-border);
}
.record-list-row {
  width: 100%;
  min-height: 68px;
  padding: 8px 14px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.record-list-row:hover,
.record-list-row[aria-expanded="true"] {
  background: color-mix(in oklch, var(--c-bg) 55%, var(--c-surface));
}
.record-thumbnail {
  width: 44px;
  height: 48px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--c-border);
  background: var(--c-bg);
  color: var(--c-ink-2);
}
.record-thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.record-product {
  min-width: 0;
  display: grid;
  gap: 5px;
}
.record-product strong {
  overflow: hidden;
  font-size: var(--font-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.record-product strong.is-placeholder {
  color: var(--c-ink-2);
  font-weight: 500;
}
.placeholder-tag {
  justify-self: start;
  padding: 2px 6px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-tag);
  background: var(--c-bg);
  color: var(--c-ink-2);
  font-size: var(--font-xs);
  line-height: 1.3;
}
.record-product small {
  color: var(--c-ink-2);
  font-size: var(--font-xs);
}
.record-metric {
  color: var(--c-ink);
  font-family: var(--font-mono);
  font-size: var(--font-xs);
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}
.record-edit-count {
  color: var(--c-ink-2);
  font-size: var(--font-xs);
  text-align: right;
  white-space: nowrap;
}
.record-ticket {
  margin: 0 14px 14px;
  padding: 16px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-tag);
  background: var(--c-surface);
}
.ticket-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 11px;
  border-bottom: 1px solid var(--c-border);
  color: var(--c-ink-2);
  font-family: var(--font-mono);
  font-size: var(--font-xs);
}
.ticket-heading-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.ticket-heading b {
  color: var(--c-success);
  font-family: var(--font-body);
  font-weight: 500;
}
.terminal-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px 18px;
  margin: 14px 0;
}
.terminal-fields div {
  min-width: 0;
}
.terminal-fields dt,
.ticket-description strong,
.ticket-skus strong,
.edits-flow > strong {
  margin-bottom: 4px;
  color: var(--c-ink-2);
  font-size: var(--font-xs);
}
.terminal-fields dd {
  margin: 0;
  font-size: var(--font-sm);
  overflow-wrap: anywhere;
}
.record-editor {
  display: grid;
  gap: var(--space-3);
  margin: 14px 0;
  padding: var(--space-3);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  background: var(--c-bg);
}
.record-editor > strong,
.sku-editor > strong {
  color: var(--c-ink);
  font-size: var(--font-sm);
}
.record-editor-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
}
.record-editor-grid > label,
.sku-editor-row label {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
  color: var(--c-ink-2);
  font-size: var(--font-xs);
}
.record-editor input,
.record-editor select {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 36px;
  padding: 6px 9px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  background: var(--c-surface);
  color: var(--c-ink);
  font: inherit;
}
.record-editor-wide {
  grid-column: 1 / -1;
}
.record-editor fieldset {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 8px;
  border: 1px solid var(--c-border);
}
.record-editor fieldset legend {
  padding: 0 4px;
  color: var(--c-ink-2);
  font-size: var(--font-xs);
}
.record-editor fieldset .season-choice {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--c-ink);
  font-size: var(--font-xs);
}
.record-editor fieldset .season-choice input {
  width: auto;
  min-height: auto;
}
.sku-editor {
  display: grid;
  gap: var(--space-2);
}
.sku-editor-row {
  display: grid;
  grid-template-columns: minmax(90px, 1fr) repeat(3, minmax(100px, 1fr));
  align-items: end;
  gap: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--c-border);
}
.sku-editor-row > span {
  padding-bottom: 8px;
  color: var(--c-ink);
  font-size: var(--font-xs);
}
.record-editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
.describe-button--primary {
  background: var(--c-primary);
  color: var(--c-surface);
}
.ticket-description,
.ticket-skus {
  padding-top: 10px;
  border-top: 1px solid var(--c-border);
}
.ticket-description-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.description-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.platform-tabs {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
  border-bottom: 1px solid var(--c-border);
}
.platform-tabs button {
  min-height: 32px;
  padding: 4px 10px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--c-ink-2);
  font-size: var(--font-xs);
  cursor: pointer;
}
.platform-tabs button[aria-selected="true"] {
  border-bottom-color: var(--c-primary);
  color: var(--c-primary);
}
.ticket-description p {
  margin: 5px 0;
  white-space: pre-wrap;
  font-size: var(--font-xs);
}
.describe-button {
  padding: 5px 9px;
  border: 1px solid var(--c-primary);
  background: transparent;
  color: var(--c-primary);
  font-size: var(--font-xs);
  cursor: pointer;
}
.describe-button:disabled {
  opacity: 0.6;
  cursor: wait;
}
.typing-caret {
  display: inline-block;
  width: 1px;
  height: 1em;
  margin-left: 2px;
  background: var(--c-primary);
  vertical-align: text-bottom;
  animation: typing-caret-blink 1s steps(2, start) infinite;
}
.description-error {
  color: var(--c-error);
  font-size: var(--font-xs);
}
.description-notice {
  color: var(--c-warn-ink);
  font-size: var(--font-xs);
}
.description-confidence {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 9px;
  color: var(--c-ink-2);
  font-size: var(--font-xs);
}
.description-confidence small {
  font-size: var(--font-xs);
}
.description-confidence b {
  color: var(--c-primary);
  font-family: var(--font-mono);
  font-size: var(--font-xs);
  font-variant-numeric: tabular-nums;
}
.confidence-scale {
  display: inline-grid;
  grid-template-columns: repeat(5, 5px);
  gap: 2px;
  vertical-align: middle;
}
.confidence-scale i {
  width: 5px;
  height: 7px;
  border: 1px solid var(--c-primary);
  background: transparent;
}
.confidence-scale i.confidence-tick--filled {
  background: var(--c-primary);
}
.confidence-scale--low {
  color: var(--c-warn-ink);
}
.confidence-scale--low i {
  border-color: var(--c-warn-ink);
}
.confidence-scale--low i.confidence-tick--filled {
  background: var(--c-warn-ink);
}
@keyframes typing-caret-blink {
  to {
    visibility: hidden;
  }
}
.ticket-skus {
  display: grid;
  gap: 5px;
  font-size: var(--font-xs);
}
.edits-flow {
  display: grid;
  gap: 7px;
  margin-top: 12px;
}
.edit-flow-row {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 12px;
  align-items: baseline;
  font-size: var(--font-xs);
}
.edit-flow-row code {
  color: var(--c-ink);
  font-family: var(--font-mono);
  font-size: var(--font-xs);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.no-edits {
  margin: 12px 0 0;
  color: var(--c-ink-2);
  font-size: var(--font-xs);
}
.records-state {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 180px;
  border: 1px dashed var(--c-border);
  color: var(--c-ink-2);
  font-size: var(--font-sm);
}
.records-state--empty {
  flex-direction: column;
  gap: 9px;
}
.records-state--empty strong {
  color: var(--c-ink);
  font-family: var(--font-heading);
  font-size: var(--font-lg);
}
.records-state--empty a,
.records-footer a {
  color: var(--c-primary);
  font-size: var(--font-xs);
  text-decoration: none;
}
.empty-mark {
  color: var(--c-primary);
  font-size: 22px;
}
.records-alert {
  padding: 10px 12px;
  border-left: 2px solid var(--c-error);
  background: var(--c-surface);
  color: var(--c-error);
  font-size: var(--font-xs);
}
.records-footer {
  display: flex;
  justify-content: space-between;
  padding: 18px 0;
  color: var(--c-ink-2);
  font-family: var(--font-mono);
  font-size: var(--font-xs);
}
@media (max-width: 760px) {
  .records-main {
    width: calc(100% - 28px);
  }
  .records-table-head {
    display: none;
  }
  .record-list-row {
    grid-template-columns: 46px minmax(0, 1fr) 58px;
    gap: 8px;
  }
  .record-metric:nth-of-type(4),
  .record-metric:nth-of-type(5) {
    grid-column: 2;
    justify-self: start;
  }
  .record-edit-count {
    grid-column: 3;
    grid-row: 2;
  }
  .terminal-fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .record-editor-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .record-editor-wide {
    grid-column: 1 / -1;
  }
  .sku-editor-row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .sku-editor-row > span {
    grid-column: 1 / -1;
  }
}
</style>
