import {
  DescribeResultSchema,
  ProductRecordSchema,
  ProductRecordWithImageUrlsSchema,
  RecognizeResponseSchema,
  RecognizeResultSchema,
  UploadFileSchema,
  type ProductRecord,
  type ProductRecordWithImageUrls,
  type RecognizeResponse,
  type UploadFile,
} from "@scope/shared/schema";
import { apiBaseUrl } from "./config";

export type ApiMethod = "GET" | "POST" | "PUT";

export interface SseEvent {
  event: string;
  data: string;
}

const SSE_REQUEST_TIMEOUT_MS = 60_000;

export function buildAccessHeaders(accessCode: string): Record<string, string> {
  return { "x-access-code": accessCode };
}

export function parseRecognizeResponse(value: unknown): RecognizeResponse {
  const response = RecognizeResponseSchema.safeParse(value, { jitless: true });
  if (!response.success) {
    throw new Error("E_RECOGNIZE_INVALID: 识别响应格式不正确");
  }
  const result = RecognizeResultSchema.safeParse(response.data.result, {
    jitless: true,
  });
  if (!result.success) {
    throw new Error("E_RECOGNIZE_INVALID: 识别结果未通过校验");
  }
  return { ...response.data, result: result.data };
}

export function parseUploadResponse(value: unknown): UploadFile {
  const payload = parseJson(value);
  const parsed = UploadFileSchema.safeParse(payload, { jitless: true });
  if (!parsed.success) throw new Error("E_FORMAT: 上传响应格式不正确");
  return parsed.data;
}

export function parseProductRecord(value: unknown): ProductRecord {
  const parsed = ProductRecordSchema.safeParse(value, { jitless: true });
  if (!parsed.success) throw new Error("E_VALIDATION: 商品记录字段不完整");
  return parsed.data;
}

export function parseProductRecordWithImageUrls(
  value: unknown,
): ProductRecordWithImageUrls {
  const parsed = ProductRecordWithImageUrlsSchema.safeParse(value, {
    jitless: true,
  });
  if (!parsed.success) throw new Error("E_VALIDATION: 商品记录格式不正确");
  return parsed.data;
}

export function parseProductRecordList(
  value: unknown,
): ProductRecordWithImageUrls[] {
  const parsed = ProductRecordWithImageUrlsSchema.array().safeParse(value, {
    jitless: true,
  });
  if (!parsed.success) throw new Error("E_VALIDATION: 记录列表格式不正确");
  return parsed.data;
}

export function parseSseEvents(source: string): SseEvent[] {
  const events: SseEvent[] = [];
  const normalized = source.replace(/\r\n/g, "\n");
  for (const block of normalized.split("\n\n")) {
    if (!block.trim()) continue;
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:"))
        data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length) events.push({ event, data: data.join("\n") });
  }
  return events;
}

export function requestApi(
  path: string,
  method: ApiMethod = "GET",
  data?: string | Record<string, unknown> | ArrayBuffer,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const accessCode = String(uni.getStorageSync("snap2sku-access-code") || "");
    const header =
      method === "GET"
        ? undefined
        : {
            ...buildAccessHeaders(accessCode),
            "content-type": "application/json",
          };
    uni.request({
      url: `${apiBaseUrl}${path}`,
      method,
      data,
      header,
      success: (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(
            new Error(apiErrorMessage(response.statusCode, response.data)),
          );
          return;
        }
        resolve(response.data);
      },
      fail: () =>
        reject(new Error("E_UPSTREAM: 请求失败，请检查网络和服务地址")),
    });
  });
}

export function requestSse(path: string): Promise<SseEvent[]> {
  return new Promise((resolve, reject) => {
    const accessCode = String(uni.getStorageSync("snap2sku-access-code") || "");
    uni.request({
      url: `${apiBaseUrl}${path}`,
      method: "POST",
      header: {
        ...buildAccessHeaders(accessCode),
        "content-type": "application/json",
      },
      data: {},
      dataType: "text",
      responseType: "text",
      timeout: SSE_REQUEST_TIMEOUT_MS,
      success: (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(
            new Error(apiErrorMessage(response.statusCode, response.data)),
          );
          return;
        }
        if (typeof response.data !== "string") {
          reject(new Error("E_UPSTREAM: 文案响应格式不正确"));
          return;
        }
        resolve(parseSseEvents(response.data));
      },
      fail: () =>
        reject(new Error("E_UPSTREAM: 文案生成失败，请检查网络后重试")),
    });
  });
}

export function absoluteImageUrl(path: string): string {
  return `${apiBaseUrl}${path}`;
}

export function parseDescribeResultConfidence(
  value: unknown,
): { description: number; overall: number } | undefined {
  const parsed = DescribeResultSchema.shape.confidence.safeParse(value, {
    jitless: true,
  });
  return parsed.success ? parsed.data : undefined;
}

export function apiErrorMessage(statusCode: number, value: unknown): string {
  const payload = parseJson(value);
  if (isRecord(payload)) {
    const nested = isRecord(payload.data) ? payload.data : payload;
    const code =
      typeof nested.code === "string"
        ? nested.code
        : statusCodeCode(statusCode);
    if (code === "E_IMAGE_MISSING") {
      return `${code}: 图片已失效，请重新选择照片并重新识别后再提交`;
    }
    if (code === "E_BUDGET_EXHAUSTED") {
      return `${code}: 试用额度已用完，请稍后再试`;
    }
    const message =
      typeof nested.message === "string"
        ? nested.message
        : "请求没有完成，请稍后重试";
    return `${code}: ${message}`;
  }
  return `${statusCodeCode(statusCode)}: 请求没有完成，请检查网络后重试`;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function statusCodeCode(statusCode: number): string {
  if (statusCode === 402) return "E_BUDGET_EXHAUSTED";
  if (statusCode === 401) return "E_ACCESS_CODE_REQUIRED";
  if (statusCode === 413) return "E_SIZE";
  if (statusCode === 415 || statusCode === 400) return "E_FORMAT";
  if (statusCode >= 500) return "E_UPSTREAM";
  return "E_VALIDATION";
}
