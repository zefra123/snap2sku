<script setup lang="ts">
import { computed, ref } from "vue";
import { onPullDownRefresh, onShow } from "@dcloudio/uni-app";
import type { ProductRecordWithImageUrls } from "@scope/shared/schema";
import {
  absoluteImageUrl,
  parseProductRecordList,
  requestApi,
} from "../../api";

const records = ref<ProductRecordWithImageUrls[]>([]);
const search = ref("");
const loading = ref(false);
const errorMessage = ref("");
const filteredRecords = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  if (!query) return records.value;
  return records.value.filter((record) =>
    [
      record.recognize.item_name,
      record.recognize.category,
      record.recognize.style,
      record.recognize.colors.map((color) => color.name).join(" "),
      record.recognize.seasons.join(" "),
      record.recognize.audience,
      ...record.sku.map((sku) => `${sku.color} ${sku.size}`),
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query),
  );
});

onShow(() => void loadRecords());
onPullDownRefresh(() => void loadRecords());

async function loadRecords(): Promise<void> {
  loading.value = true;
  errorMessage.value = "";
  try {
    const nextRecords = parseProductRecordList(
      await requestApi("/api/records"),
    );
    records.value = nextRecords;
    uni.setStorageSync("snap2sku-record-cache", nextRecords);
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "E_UPSTREAM: 记录暂时无法读取，请稍后重试";
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
}

function openRecord(id: string): void {
  uni.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(id)}` });
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}
</script>

<template>
  <view class="page">
    <view class="heading">
      <text class="eyebrow">PRODUCT RECORDS · 02 / 03</text>
      <text class="heading-title">商品记录</text>
      <text class="subtle">按最新创建时间排列</text>
    </view>

    <input
      v-model="search"
      class="search"
      placeholder="搜索商品名、品类、颜色或尺码"
    />

    <view v-if="errorMessage" class="notice error" @tap="loadRecords"
      >{{ errorMessage }} · 点击重试</view
    >
    <view v-else-if="loading && !records.length" class="state"
      >正在读取记录…</view
    >
    <view v-else-if="!filteredRecords.length" class="state empty">
      <text class="empty-title">{{
        search ? "没有匹配的记录" : "还没有商品记录"
      }}</text>
      <text class="subtle">完成商品识别并提交后，记录会显示在这里。</text>
    </view>
    <view v-else class="record-list">
      <view
        v-for="record in filteredRecords"
        :key="record.id"
        class="record-card"
        @tap="openRecord(record.id)"
      >
        <view class="thumbnail-wrap">
          <image
            v-if="record.imageUrls[0]"
            class="thumbnail"
            :src="absoluteImageUrl(record.imageUrls[0])"
            mode="aspectFill"
          />
          <view v-else class="thumbnail placeholder">无图</view>
          <text v-if="record.imageUrls.length > 1" class="image-count"
            >{{ record.imageUrls.length }} 图</text
          >
        </view>
        <view class="record-content">
          <text class="record-name">{{ record.recognize.item_name }}</text>
          <text class="record-meta"
            >{{ record.recognize.category }} ·
            {{
              record.recognize.colors.map((color) => color.name).join("、")
            }}</text
          >
          <text class="record-meta"
            >{{ formatDate(record.createdAt) }} ·
            {{ record.sku.length }} 个规格</text
          >
        </view>
        <text class="chevron">›</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
}
.heading {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2) 0;
}
.eyebrow {
  color: var(--c-primary);
  font-family: var(--font-mono);
  font-size: var(--font-xs);
  letter-spacing: 2rpx;
}
.heading-title {
  color: var(--c-ink);
  font-family: var(--font-heading);
  font-size: var(--font-xl);
  font-weight: 600;
}
.subtle {
  color: var(--c-ink-2);
  font-size: var(--font-xs);
}
.search {
  box-sizing: border-box;
  width: 100%;
  padding: var(--space-3);
  border: 1rpx solid var(--c-border);
  border-radius: var(--radius);
  background: var(--c-surface);
  color: var(--c-ink);
}
.record-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.record-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
  padding: var(--space-3);
  border: 1rpx solid var(--c-border);
  border-radius: var(--radius-tag);
  background: var(--c-surface);
}
.thumbnail-wrap {
  position: relative;
  width: 112rpx;
  height: 128rpx;
  flex: 0 0 112rpx;
  overflow: hidden;
  border-radius: var(--radius);
  background: var(--c-bg);
}
.thumbnail {
  width: 100%;
  height: 100%;
}
.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--c-ink-2);
  font-size: var(--font-xs);
}
.image-count {
  position: absolute;
  right: var(--space-1);
  bottom: var(--space-1);
  padding: 2rpx 8rpx;
  border-radius: var(--radius-full);
  background: var(--c-ink);
  color: var(--c-surface);
  font-size: var(--font-xs);
}
.record-content {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--space-1);
}
.record-name {
  overflow: hidden;
  color: var(--c-ink);
  font-size: var(--font-base);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.record-meta {
  overflow: hidden;
  color: var(--c-ink-2);
  font-size: var(--font-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chevron {
  color: var(--c-ink-2);
  font-size: var(--font-xl);
}
.state {
  display: flex;
  min-height: 220rpx;
  align-items: center;
  justify-content: center;
  color: var(--c-ink-2);
  font-size: var(--font-sm);
}
.empty {
  flex-direction: column;
  gap: var(--space-2);
  text-align: center;
}
.empty-title {
  color: var(--c-ink);
  font-size: var(--font-lg);
  font-weight: 600;
}
.notice {
  padding: var(--space-3);
  border-left: 6rpx solid var(--c-error);
  background: var(--c-surface);
  color: var(--c-error);
  font-size: var(--font-sm);
}
</style>
