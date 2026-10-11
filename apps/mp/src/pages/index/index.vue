<script setup lang="ts">
import { computed, ref } from "vue";
import {
  SIZES_TOP,
  type ProductRecord,
  type RecognizeResult,
  type UploadFile,
} from "@scope/shared/schema";
import {
  apiErrorMessage,
  buildAccessHeaders,
  parseProductRecord,
  parseRecognizeResponse,
  parseUploadResponse,
} from "../../api";
import { apiBaseUrl } from "../../config";

const accessCode = ref(uni.getStorageSync("snap2sku-access-code") || "");
const photoPath = ref("");
const fileId = ref("");
const originalSize = ref(0);
const recognized = ref<RecognizeResult>();
const busy = ref(false);
const message = ref("");
const errorMessage = ref("");
const stock = ref("0");
const tagPrice = ref("");
const wholesalePrice = ref("");
const size = ref<string>(SIZES_TOP[2] ?? "M");
const startedAt = ref(0);
const recognizedAt = ref(0);
const saved = ref(false);
const costEstimate = ref(0);

const canSubmit = computed(
  () => Boolean(recognized.value && fileId.value && !busy.value && !saved.value),
);

function saveAccessCode(): void {
  uni.setStorageSync("snap2sku-access-code", accessCode.value.trim());
  accessCode.value = accessCode.value.trim();
  message.value = "访问码已保存在本机";
}

function chooseAndRecognize(): void {
  clearNotices();
  startedAt.value = Date.now();
  uni.chooseImage({
    count: 1,
    sizeType: ["original"],
    sourceType: ["camera", "album"],
    success: (result) => {
      const path = result.tempFilePaths[0];
      if (!path) {
        showError("E_FORMAT: 没有选中图片");
        return;
      }
      void uploadAndRecognize(path);
    },
    fail: () => showError("E_FORMAT: 拍照或选择图片失败，请重试"),
  });
}

async function uploadAndRecognize(path: string): Promise<void> {
  busy.value = true;
  try {
    photoPath.value = path;
    originalSize.value = await getFileSize(path);
    const imageInfo = await getImageDimensions(path);
    const scale = Math.min(1, 1024 / Math.max(imageInfo.width, imageInfo.height));
    const compressedPath = await compressPhoto(path, {
      width: Math.max(1, Math.round(imageInfo.width * scale)),
      height: Math.max(1, Math.round(imageInfo.height * scale)),
    });
    const uploaded: UploadFile = await uploadPhoto(compressedPath, originalSize.value);
    fileId.value = uploaded.fileId;
    const recognition = await recognizePhoto(uploaded.fileId);
    recognized.value = recognition.result;
    costEstimate.value = recognition.costEstimate;
    tagPrice.value = recognition.result.tagPrice === null ? "" : String(recognition.result.tagPrice);
    wholesalePrice.value = "";
    stock.value = "0";
    recognizedAt.value = Date.now();
    saved.value = false;
    message.value = `识别完成，压缩后 ${(uploaded.compressedSize / 1024).toFixed(0)} KB`;
  } catch (error) {
    showError(error instanceof Error ? error.message : "E_UPSTREAM: 操作失败，请稍后重试");
  } finally {
    busy.value = false;
  }
}

async function uploadPhoto(path: string, sizeBeforeCompression: number): Promise<UploadFile> {
  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: `${apiBaseUrl}/api/upload`,
      filePath: path,
      name: "image",
      formData: { originalSize: String(sizeBeforeCompression) },
      header: buildAccessHeaders(accessCode.value),
      success: (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(apiErrorMessage(response.statusCode, response.data)));
          return;
        }
        try {
          resolve(parseUploadResponse(response.data));
        } catch (error) {
          reject(error);
        }
      },
      fail: () => reject(new Error("E_UPSTREAM: 图片上传失败，请检查网络后重试")),
    });
  });
}

async function recognizePhoto(uploadedFileId: string) {
  const response = await requestJson("/api/recognize", {
    fileId: uploadedFileId,
  });
  return parseRecognizeResponse(response);
}

async function submitRecord(): Promise<void> {
  if (!recognized.value || !fileId.value) return;
  clearNotices();
  busy.value = true;
  try {
    const now = Date.now();
    const draft = {
      id: createUuid(),
      createdAt: new Date(now).toISOString(),
      durationMs: {
        uploadStart: startedAt.value || now,
        recognizedAt: recognizedAt.value || now,
        submittedAt: now,
      },
      images: [fileId.value],
      recognize: recognized.value,
      edits: [],
      sku: [
        {
          color: recognized.value.colors[0]?.name ?? "未命名",
          size: size.value,
          stock: Number(stock.value),
          tagPrice: Number(tagPrice.value),
          wholesalePrice: Number(wholesalePrice.value),
        },
      ],
      description: "",
      aiCorrect: {},
      costEstimate: costEstimate.value,
    } satisfies ProductRecord;
    const record = parseProductRecord(draft);
    await requestJson("/api/records", record);
    saved.value = true;
    message.value = "记录已保存，可在 Web 端记录页查看";
  } catch (error) {
    showError(error instanceof Error ? error.message : "E_VALIDATION: 记录未保存，请检查填写内容");
  } finally {
    busy.value = false;
  }
}

function requestJson(path: string, data: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${apiBaseUrl}${path}`,
      method: "POST",
      data,
      header: {
        ...buildAccessHeaders(accessCode.value),
        "content-type": "application/json",
      },
      success: (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(apiErrorMessage(response.statusCode, response.data)));
          return;
        }
        resolve(response.data);
      },
      fail: () => reject(new Error("E_UPSTREAM: 请求失败，请检查网络和服务地址")),
    });
  });
}

function getFileSize(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    uni.getFileInfo({
      filePath: path,
      success: (result) => resolve(result.size),
      fail: () => reject(new Error("E_FORMAT: 无法读取图片大小")),
    });
  });
}

function getImageDimensions(path: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    uni.getImageInfo({
      src: path,
      success: ({ width, height }) => resolve({ width, height }),
      fail: () => reject(new Error("E_FORMAT: 无法读取图片尺寸")),
    });
  });
}

function compressPhoto(
  path: string,
  dimensions: { width: number; height: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    uni.compressImage({
      src: path,
      quality: 85,
      compressedWidth: dimensions.width,
      compressedHeight: dimensions.height,
      success: (result) => resolve(result.tempFilePath),
      fail: () => reject(new Error("E_FORMAT: 图片压缩失败，请重新选择")),
    });
  });
}

function createUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function clearNotices(): void {
  message.value = "";
  errorMessage.value = "";
}

function showError(messageText: string): void {
  errorMessage.value = messageText;
  message.value = "";
}
</script>

<template>
  <view class="page">
    <view class="card access-card">
      <text class="title"><image class="title-icon" src="/static/brand/icons/tag.svg" mode="aspectFit" />访问码</text>
      <view class="access-row">
        <input v-model="accessCode" class="input" password placeholder="服务启用门禁时填写" />
        <button class="button secondary" @tap="saveAccessCode">保存</button>
      </view>
      <text class="hint">访问码仅保存在本机；所有写请求都会发送 x-access-code。</text>
    </view>

    <view class="hero-card">
      <image class="hero-background" src="/static/brand/hero-bg.svg" mode="widthFix" />
      <view class="hero-content">
      <text class="title"><image class="title-icon" src="/static/brand/icons/camera.svg" mode="aspectFit" />商品照片</text>
      <image v-if="photoPath" class="preview" :src="photoPath" mode="aspectFit" />
      <button class="button primary" :disabled="busy" @tap="chooseAndRecognize">
        <image v-if="busy" class="loading-icon" src="/static/brand/loading-scan.svg" mode="aspectFit" />
        <image v-else class="button-icon" src="/static/brand/icons/camera.svg" mode="aspectFit" />
        {{ busy ? '识别中…' : '拍照或从相册选择' }}
      </button>
      <text class="hint">照片会按最长边 1024px、质量 85 压缩后上传。</text>
      </view>
    </view>

    <view v-if="errorMessage" class="notice error" role="alert">{{ errorMessage }}</view>
    <view v-if="message" class="notice success" role="status">{{ message }}</view>

    <view v-if="recognized" class="card">
      <text class="title"><image class="title-icon" src="/static/brand/icons/scan.svg" mode="aspectFit" />识别结果</text>
      <view class="field-row"><text class="label"><image class="field-icon" src="/static/brand/icons/tag.svg" mode="aspectFit" />商品名称</text><input v-model="recognized.item_name" class="input" /></view>
      <view class="field-row"><text class="label"><image class="field-icon" src="/static/brand/icons/palette.svg" mode="aspectFit" />品类 / 颜色</text><text>{{ recognized.category }} · {{ recognized.colors.map((color) => color.name).join('、') }}</text></view>
      <view class="field-row"><text class="label"><image class="field-icon" src="/static/brand/icons/palette.svg" mode="aspectFit" />风格</text><text>{{ recognized.style }}</text></view>
      <view class="field-row"><text class="label"><image class="field-icon" src="/static/brand/icons/album.svg" mode="aspectFit" />季节</text><text>{{ recognized.seasons.join('、') }}</text></view>
      <view class="field-row"><text class="label"><image class="field-icon" src="/static/brand/icons/palette.svg" mode="aspectFit" />适用人群</text><text>{{ recognized.audience }}</text></view>
      <view class="field-row"><text class="label"><image class="field-icon" src="/static/brand/icons/tag.svg" mode="aspectFit" />面料</text><text>{{ recognized.fabric || '未识别' }}</text></view>
      <view class="field-row"><text class="label"><image class="field-icon" src="/static/brand/icons/size.svg" mode="aspectFit" />SKU 尺码</text>
        <picker :range="SIZES_TOP" @change="size = SIZES_TOP[Number($event.detail.value)] ?? size">
          <view class="picker-value">{{ size }}　⌄</view>
        </picker>
      </view>
      <view class="field-row"><text class="label">库存</text><input v-model="stock" class="input numeric" type="number" /></view>
      <view class="field-row"><text class="label">吊牌价</text><input v-model="tagPrice" class="input numeric" type="digit" placeholder="必填" /></view>
      <view class="field-row"><text class="label">批发单价</text><input v-model="wholesalePrice" class="input numeric" type="digit" placeholder="必填" /></view>
      <button class="button primary" :disabled="!canSubmit" @tap="submitRecord">
        {{ saved ? '已保存' : busy ? '正在保存…' : '提交记录' }}
      </button>
    </view>

    <text class="footer">API：{{ apiBaseUrl }}</text>
  </view>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); }
.card { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); border: 1rpx solid var(--c-border); border-radius: var(--radius-tag); background: var(--c-surface); }
.hero-card { position: relative; overflow: hidden; border: 1rpx solid var(--c-border); border-radius: var(--radius-tag); background: var(--c-surface); }
.hero-background { position: absolute; top: 0; right: 0; width: 100%; z-index: 0; }
.hero-content { position: relative; z-index: 1; display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); }
.title { display: flex; align-items: center; gap: 12rpx; font-size: var(--font-lg); font-weight: 600; }
.title-icon { width: 40rpx; height: 40rpx; }
.field-icon { width: 30rpx; height: 30rpx; margin-right: 8rpx; vertical-align: middle; }
.button-icon { width: 36rpx; height: 36rpx; margin-right: 10rpx; vertical-align: middle; }
.loading-icon { width: 120rpx; height: 120rpx; margin-right: 8rpx; vertical-align: middle; }
.access-row { display: flex; gap: 14rpx; }
.input { box-sizing: border-box; min-width: 0; flex: 1; padding: 18rpx; border: 1rpx solid var(--c-border); border-radius: var(--radius); background: var(--c-surface); color: var(--c-ink); }
.numeric { max-width: 220rpx; text-align: right; }
.hint,.footer { color: var(--c-ink-2); font-size: var(--font-xs); line-height: 1.5; }
.button { margin: 0; font-size: 28rpx; }
.primary { background: var(--c-primary); color: var(--c-surface); }
.secondary { flex: 0 0 auto; background: var(--c-bg); color: var(--c-ink); }
.preview { width: 100%; height: 380rpx; border-radius: var(--radius-tag); background: var(--c-bg); }
.notice { padding: 20rpx; border-left: 6rpx solid; border-radius: 4rpx; background: #fbfaf6; line-height: 1.5; }
.error { border-color: var(--c-error); color: var(--c-error); }
.success { border-color: var(--c-success); color: var(--c-success); }
.field-row { display: flex; align-items: center; justify-content: space-between; gap: 20rpx; min-height: 68rpx; }
.label { display: flex; align-items: center; width: 150rpx; flex: 0 0 auto; color: var(--c-ink-2); font-size: var(--font-sm); }
.field-row > text:last-child { text-align: right; }
.picker-value { min-width: 140rpx; padding: 12rpx; border: 1rpx solid var(--c-border); border-radius: var(--radius); text-align: center; }
.footer { padding: 8rpx 0 28rpx; overflow-wrap: anywhere; }
</style>
