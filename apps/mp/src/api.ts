import {
  ProductRecordSchema,
  RecognizeResponseSchema,
  RecognizeResultSchema,
  UploadFileSchema,
  type ProductRecord,
  type RecognizeResponse,
  type UploadFile,
} from "@scope/shared/schema";

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
  if (statusCode === 401) return "E_ACCESS_CODE_REQUIRED";
  if (statusCode === 413) return "E_SIZE";
  if (statusCode === 415 || statusCode === 400) return "E_FORMAT";
  if (statusCode >= 500) return "E_UPSTREAM";
  return "E_VALIDATION";
}
