import { readFile } from "node:fs/promises";
import type { H3Event } from "h3";
import {
  AUDIENCES,
  CATEGORIES,
  RecognizeResultSchema,
  SEASONS,
  STYLES,
  type RecognizeResult,
} from "@scope/shared/schema";
import {
  buildRecognitionSystemPrompt,
  buildRecognitionUserPrompt,
} from "@scope/prompts/recognize";
import { failApi } from "./api-error";
import { findUploadPath } from "./store";

export type MockFixture = "tagPrice" | "noTagPrice" | "allNull";

const fixtures: Record<MockFixture, unknown> = {
  tagPrice: {
    category: "外套",
    colors: [
      { name: "藏青", hex: "#263A55" },
      { name: "米白", hex: "#E8E0D0" },
    ],
    style: "通勤",
    seasons: ["春", "秋"],
    audience: "女",
    fabric: "棉混纺",
    tagPrice: 399,
    item_name: "简约通勤藏青短款外套",
    confidence: { category: 0.94, colors: 0.88, style: 0.83, overall: 0.88 },
  },
  noTagPrice: {
    category: "上衣",
    colors: [{ name: "奶油黄", hex: "#E9D9A6" }],
    style: "休闲",
    seasons: ["春", "夏"],
    audience: "中性",
    fabric: null,
    tagPrice: null,
    item_name: "宽松休闲奶油黄短袖上衣",
    confidence: { category: 0.91, colors: 0.62, style: 0.79, overall: 0.74 },
  },
  allNull: {
    category: null,
    colors: null,
    style: null,
    seasons: null,
    audience: null,
    fabric: null,
    tagPrice: null,
    item_name: null,
    confidence: null,
  },
};

export function getMockRecognizeResult(fixture: MockFixture): RecognizeResult {
  return RecognizeResultSchema.parse(
    normalizeRecognizeResult(fixtures[fixture]),
  );
}

export function normalizeRecognizeResult(value: unknown): unknown {
  if (!isRecord(value)) return value;

  const result = { ...value };
  let usedFallback = false;
  const confidence = isRecord(value.confidence) ? { ...value.confidence } : {};

  if (result.category === null || result.category === undefined) {
    result.category =
      CATEGORIES.find((category) => category === "其他") ?? CATEGORIES[0];
    confidence.category = 0.4;
    usedFallback = true;
  }
  if (result.style === null || result.style === undefined) {
    result.style = STYLES.find((style) => style === "其他") ?? STYLES[0];
    confidence.style = 0.4;
    usedFallback = true;
  }
  if (result.colors === null || result.colors === undefined) {
    result.colors = [{ name: "其他", hex: "#808080" }];
    confidence.colors = 0.4;
    usedFallback = true;
  }
  if (
    result.seasons === null ||
    result.seasons === undefined ||
    (Array.isArray(result.seasons) && result.seasons.length === 0)
  ) {
    result.seasons = [SEASONS.find((season) => season === "秋") ?? SEASONS[0]];
    usedFallback = true;
  }
  if (result.audience === null || result.audience === undefined) {
    result.audience =
      AUDIENCES.find((audience) => audience === "中性") ?? AUDIENCES[0];
    usedFallback = true;
  }
  if (result.item_name === null || result.item_name === undefined) {
    result.item_name = "待人工确认的服装商品";
    usedFallback = true;
  }

  for (const field of ["category", "colors", "style", "overall"] as const) {
    if (
      typeof confidence[field] !== "number" ||
      !Number.isFinite(confidence[field])
    )
      confidence[field] = 0.4;
  }
  if (usedFallback)
    confidence.overall = Math.min(confidence.overall as number, 0.4);
  result.confidence = confidence;

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function recognizeImage(
  fileId: string,
  fixture: MockFixture,
  event: H3Event,
): Promise<RecognizeResult> {
  const config = useRuntimeConfig(event);
  const imagePath = await findUploadPath(fileId);
  if (!imagePath) failApi(404, "E_FILE_NOT_FOUND", "找不到已上传的图片");
  const mockEnabled =
    String(config.visionMock) === "1" || config.public.visionMock;
  if (mockEnabled) return getMockRecognizeResult(fixture);

  if (!config.visionApiKey) {
    failApi(
      503,
      "E_UPSTREAM",
      "尚未配置视觉模型 API key；本地演示可设置 NUXT_VISION_MOCK=1",
    );
  }

  const image = await readFile(imagePath);
  const mime = imagePath.endsWith(".png")
    ? "image/png"
    : imagePath.endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";
  return requestVisionModel(
    image,
    mime,
    config.visionApiKey,
    config.visionModel,
    config.visionBaseUrl,
  );
}

async function requestVisionModel(
  image: Buffer,
  mime: string,
  apiKey: string,
  model: string,
  baseUrl: string,
): Promise<RecognizeResult> {
  const imageBase64 = image.toString("base64");
  const configuredEndpoint = baseUrl || "https://open.bigmodel.cn/api/paas/v4";
  const endpoint = /\/chat\/completions\/?$/i.test(configuredEndpoint)
    ? configuredEndpoint.replace(/\/+$/, "")
    : `${configuredEndpoint.replace(/\/+$/, "")}/chat/completions`;
  let repairPrompt: string | undefined;
  let lastUpstreamError = "视觉模型请求失败";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model || "glm-4v-flash",
          temperature: 0.1,
          messages: [
            {
              role: "system",
              content: buildRecognitionSystemPrompt(repairPrompt),
            },
            {
              role: "user",
              content: [
                { type: "text", text: buildRecognitionUserPrompt(1) },
                {
                  type: "image_url",
                  image_url: { url: `data:${mime};base64,${imageBase64}` },
                },
              ],
            },
          ],
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      lastUpstreamError =
        error instanceof Error ? error.message : "视觉模型请求失败";
      if (attempt === 0) {
        await pauseBeforeRetry();
        continue;
      }
      failApi(502, "E_UPSTREAM", lastUpstreamError);
    }

    if (!response.ok) {
      if (
        (response.status === 429 || response.status >= 500) &&
        attempt === 0
      ) {
        lastUpstreamError = `视觉模型返回 HTTP ${response.status}`;
        await pauseBeforeRetry();
        continue;
      }
      const rateLimited = response.status === 429;
      failApi(
        rateLimited ? 429 : 502,
        rateLimited ? "E_RATE_LIMIT" : "E_UPSTREAM",
        `视觉模型返回 HTTP ${response.status}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      repairPrompt =
        "上一次响应不是有效 JSON。请重新识别并仅返回符合格式的 JSON。";
      if (attempt === 0) continue;
      failApi(502, "E_UPSTREAM", "视觉服务响应正文不是有效 JSON");
    }

    const content = extractModelText(payload);
    if (!content) {
      repairPrompt =
        "上一次响应缺少识别结果文本。请重新识别并仅返回符合格式的 JSON。";
      if (attempt === 0) continue;
      failApi(502, "E_UPSTREAM", "视觉模型响应格式无法识别");
    }

    const decoded = parseModelJson(content);
    if (!decoded.success) {
      repairPrompt =
        "上一次响应无法提取出有效 JSON 对象。请按系统提示重新识别，并只返回一个 JSON 对象，不要输出思考过程、说明文字或 Markdown 代码块。";
      if (attempt === 0) continue;
      failApi(
        422,
        "E_RECOGNIZE_INVALID",
        `模型两次响应均未包含可解析的 JSON 对象（末次响应 ${content.length} 字符）`,
      );
    }

    const result = RecognizeResultSchema.safeParse(
      normalizeRecognizeResult(decoded.data),
    );
    if (result.success) return result.data;
    repairPrompt = `上一次 JSON 未通过 schema 校验，请修复并只返回 JSON：${result.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ")}`;
    if (attempt === 1)
      failApi(422, "E_RECOGNIZE_INVALID", "视觉模型结果重试后仍未通过数据校验");
  }

  failApi(502, "E_UPSTREAM", lastUpstreamError);
}

function parseModelJson(
  content: string,
): { success: true; data: unknown } | { success: false } {
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return { success: true, data: JSON.parse(cleaned) };
  } catch {
    const objectText = extractFirstJsonObject(cleaned);
    if (!objectText) return { success: false };
    try {
      return { success: true, data: JSON.parse(objectText) };
    } catch {
      return { success: false };
    }
  }
}

function extractFirstJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}

function extractModelText(payload: unknown): string | undefined {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("choices" in payload) ||
    !Array.isArray(payload.choices)
  )
    return undefined;
  const firstChoice: unknown = payload.choices[0];
  if (
    typeof firstChoice !== "object" ||
    firstChoice === null ||
    !("message" in firstChoice)
  )
    return undefined;
  const message: unknown = firstChoice.message;
  if (
    typeof message !== "object" ||
    message === null ||
    !("content" in message) ||
    typeof message.content !== "string"
  )
    return undefined;
  return message.content;
}

async function pauseBeforeRetry(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}
