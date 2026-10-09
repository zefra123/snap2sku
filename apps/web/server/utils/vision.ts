import { readFile } from "node:fs/promises";
import type { H3Event } from "h3";
import {
  AUDIENCES,
  CATEGORIES,
  DescriptionVariantsSchema,
  DescribeResultSchema,
  RecognizeResultSchema,
  SEASONS,
  STYLES,
  type RecognizeResult,
  type RecognizeResponse,
  type ModelUsage,
  type DescribeResult,
  type DescriptionVariants,
} from "@scope/shared/schema";
import {
  DESCRIPTION_VARIANTS_SYSTEM_PROMPT,
  DESCRIPTION_SYSTEM_PROMPT,
  buildDescriptionVariantsUserPrompt,
  buildDescriptionUserPrompt,
} from "@scope/prompts/describe";
import {
  buildRecognitionSystemPrompt,
  buildRecognitionUserPrompt,
} from "@scope/prompts/recognize";
import { failApi } from "./api-error";
import { findUploadPath } from "./store";

export type MockFixture = "tagPrice" | "noTagPrice" | "allNull";

const zeroUsage: ModelUsage = {
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
};

export function parseModelUsage(payload: unknown): ModelUsage {
  const rawUsage =
    isRecord(payload) && isRecord(payload.usage) ? payload.usage : undefined;
  const promptTokens = readTokenCount(rawUsage?.prompt_tokens);
  const completionTokens = readTokenCount(rawUsage?.completion_tokens);
  const totalTokens = rawUsage?.total_tokens;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: isTokenCount(totalTokens)
      ? totalTokens
      : promptTokens + completionTokens,
  };
}

export function calculateRecognitionCost(
  usage: ModelUsage,
  inputPricePerMillion: number,
  outputPricePerMillion: number,
): number {
  const inputPrice = validPrice(inputPricePerMillion);
  const outputPrice = validPrice(outputPricePerMillion);
  const cost =
    (usage.prompt_tokens * inputPrice + usage.completion_tokens * outputPrice) /
    1_000_000;
  return Number(cost.toFixed(8));
}

export interface DescriptionGeneration {
  result: DescribeResult;
  usage: ModelUsage;
  costEstimate: number;
}

export interface DescriptionVariantsGeneration {
  result: DescriptionVariants;
  usage: ModelUsage;
  costEstimate: number;
}

export function createDescriptionGeneration(
  result: DescribeResult,
  payload: unknown,
  inputPricePerMillion: number,
  outputPricePerMillion: number,
): DescriptionGeneration {
  const usage = parseModelUsage(payload);
  return {
    result,
    usage,
    costEstimate: calculateRecognitionCost(
      usage,
      inputPricePerMillion,
      outputPricePerMillion,
    ),
  };
}

export function createDescriptionVariantsGeneration(
  result: DescriptionVariants,
  payload: unknown,
  inputPricePerMillion: number,
  outputPricePerMillion: number,
): DescriptionVariantsGeneration {
  const usage = parseModelUsage(payload);
  return {
    result,
    usage,
    costEstimate: calculateRecognitionCost(
      usage,
      inputPricePerMillion,
      outputPricePerMillion,
    ),
  };
}

export function createMockRecognizeResponse(
  fixture: MockFixture,
): RecognizeResponse {
  return {
    result: getMockRecognizeResult(fixture),
    usage: zeroUsage,
    costEstimate: 0,
  };
}

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

  if (
    result.category === null ||
    result.category === undefined ||
    !isOneOf(result.category, CATEGORIES)
  ) {
    result.category =
      CATEGORIES.find((category) => category === "其他") ?? CATEGORIES[0];
    confidence.category = 0.4;
    usedFallback = true;
  }
  if (
    result.style === null ||
    result.style === undefined ||
    !isOneOf(result.style, STYLES)
  ) {
    result.style = STYLES.find((style) => style === "其他") ?? STYLES[0];
    confidence.style = 0.4;
    usedFallback = true;
  }
  if (
    result.colors === null ||
    result.colors === undefined ||
    (Array.isArray(result.colors) && result.colors.length === 0)
  ) {
    result.colors = [{ name: "其他", hex: "#808080" }];
    confidence.colors = 0.4;
    usedFallback = true;
  }
  const seasons = result.seasons;
  if (
    seasons === null ||
    seasons === undefined ||
    !Array.isArray(seasons) ||
    seasons.filter((season) => isOneOf(season, SEASONS)).length === 0
  ) {
    result.seasons = [SEASONS.find((season) => season === "秋") ?? SEASONS[0]];
    usedFallback = true;
  } else {
    const normalizedSeasons = seasons.filter((season) =>
      isOneOf(season, SEASONS),
    );
    result.seasons = normalizedSeasons;
    if (normalizedSeasons.length !== seasons.length) usedFallback = true;
  }
  if (result.audience === "女性") result.audience = "女";
  else if (result.audience === "男性") result.audience = "男";
  if (
    result.audience === null ||
    result.audience === undefined ||
    !isOneOf(result.audience, AUDIENCES)
  ) {
    result.audience =
      AUDIENCES.find((audience) => audience === "中性") ?? AUDIENCES[0];
    usedFallback = true;
  }
  if (
    typeof result.item_name !== "string" ||
    result.item_name.length < 8 ||
    result.item_name.length > 16
  ) {
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

function readTokenCount(value: unknown): number {
  return isTokenCount(value) ? value : 0;
}

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validPrice(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function isOneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] {
  return (
    typeof value === "string" && values.some((candidate) => candidate === value)
  );
}

export async function recognizeImage(
  fileId: string,
  fixture: MockFixture,
  event: H3Event,
): Promise<RecognizeResponse> {
  const config = useRuntimeConfig(event);
  const imagePath = await findUploadPath(fileId);
  if (!imagePath) failApi(404, "E_FILE_NOT_FOUND", "找不到已上传的图片");
  const mockEnabled =
    String(config.visionMock) === "1" || config.public.visionMock;
  if (mockEnabled) return createMockRecognizeResponse(fixture);

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
    Number(config.visionInputPricePerMillion),
    Number(config.visionOutputPricePerMillion),
  );
}

export async function describeProduct(
  source: unknown,
  event: H3Event,
): Promise<DescriptionGeneration> {
  const config = useRuntimeConfig(event);
  if (!config.visionApiKey) {
    failApi(
      503,
      "E_DESCRIPTION_UNAVAILABLE",
      "描述生成服务未配置视觉模型 API key",
    );
  }

  const endpoint = getChatCompletionsEndpoint(config.visionBaseUrl);
  const inputPricePerMillion = Number(config.visionInputPricePerMillion);
  const outputPricePerMillion = Number(config.visionOutputPricePerMillion);
  let repairPrompt: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchModelResponse(
      endpoint,
      config.visionApiKey,
      config.visionModel,
      [
        {
          role: "system",
          content: repairPrompt
            ? `${DESCRIPTION_SYSTEM_PROMPT}\n\n${repairPrompt}`
            : DESCRIPTION_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: buildDescriptionUserPrompt(source),
        },
      ],
    );
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      repairPrompt =
        "上一次响应正文不是有效 JSON。请重新生成，并只返回符合格式的 JSON。";
      continue;
    }
    const content = extractModelText(payload);
    const decoded = content
      ? parseModelJson(content)
      : { success: false as const };
    if (decoded.success) {
      const result = DescribeResultSchema.safeParse(decoded.data);
      if (result.success) {
        return createDescriptionGeneration(
          result.data,
          payload,
          inputPricePerMillion,
          outputPricePerMillion,
        );
      }
      if (attempt === 1) {
        const normalized = DescribeResultSchema.safeParse(
          normalizeGeneratedDescription(decoded.data),
        );
        if (normalized.success) {
          return createDescriptionGeneration(
            normalized.data,
            payload,
            inputPricePerMillion,
            outputPricePerMillion,
          );
        }
      }
      const description = isRecord(decoded.data)
        ? decoded.data.description
        : undefined;
      const descriptionLength =
        typeof description === "string" ? Array.from(description).length : 0;
      repairPrompt = `上一次 JSON 未通过 schema 校验，请修复并只返回 JSON：${result.error.issues
        .slice(0, 8)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(
          "; ",
        )}。description 当前${descriptionLength}字，必须为60–100字；请写约80字，并在输出前检查字数。`;
    } else {
      repairPrompt =
        "上一次响应不是有效 JSON。请按系统提示重新生成，只返回一个 JSON 对象，不要输出说明文字或 Markdown。";
    }
  }

  failApi(422, "E_RECOGNIZE_INVALID", "描述模型重试后仍未通过数据校验");
}

export async function describeProductVariants(
  source: unknown,
  event: H3Event,
): Promise<DescriptionVariantsGeneration> {
  const config = useRuntimeConfig(event);
  if (!config.visionApiKey) {
    failApi(
      503,
      "E_DESCRIPTION_UNAVAILABLE",
      "描述生成服务未配置视觉模型 API key",
    );
  }

  const endpoint = getChatCompletionsEndpoint(config.visionBaseUrl);
  const inputPricePerMillion = Number(config.visionInputPricePerMillion);
  const outputPricePerMillion = Number(config.visionOutputPricePerMillion);
  let repairPrompt: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchModelResponse(
      endpoint,
      config.visionApiKey,
      config.visionModel,
      [
        {
          role: "system",
          content: repairPrompt
            ? `${DESCRIPTION_VARIANTS_SYSTEM_PROMPT}\n\n${repairPrompt}`
            : DESCRIPTION_VARIANTS_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: buildDescriptionVariantsUserPrompt(source),
        },
      ],
    );
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      repairPrompt =
        "上一次响应正文不是有效 JSON。请重新生成三种平台文案，并只返回符合格式的 JSON。";
      continue;
    }

    const content = extractModelText(payload);
    const decoded = content
      ? parseModelJson(content)
      : { success: false as const };
    if (!decoded.success) {
      repairPrompt =
        "上一次响应不是有效 JSON。请按系统提示重新生成三个平台文案，只返回 JSON 对象，不要输出说明文字或 Markdown。";
      continue;
    }

    const parsed = DescriptionVariantsSchema.safeParse(decoded.data);
    if (parsed.success) {
      return createDescriptionVariantsGeneration(
        parsed.data,
        payload,
        inputPricePerMillion,
        outputPricePerMillion,
      );
    }

    if (attempt === 1) {
      const normalized = DescriptionVariantsSchema.safeParse(
        normalizeDescriptionVariants(decoded.data),
      );
      if (normalized.success) {
        return createDescriptionVariantsGeneration(
          normalized.data,
          payload,
          inputPricePerMillion,
          outputPricePerMillion,
        );
      }
    }
    repairPrompt = `上一次 JSON 未通过 schema 校验，请修复三个平台字段并只返回 JSON：${parsed.error.issues
      .slice(0, 10)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ")}`;
  }

  failApi(422, "E_RECOGNIZE_INVALID", "平台描述模型重试后仍未通过数据校验");
}

function normalizeDescriptionVariants(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const normalized = { ...value };
  for (const platform of Object.keys(DescriptionVariantsSchema.shape)) {
    normalized[platform] = normalizeGeneratedDescription(normalized[platform]);
  }
  return normalized;
}

export function normalizeGeneratedDescription(value: unknown): unknown {
  if (!isRecord(value) || typeof value.description !== "string") return value;

  const original = value.description;
  let description = original;
  let adjusted = false;
  if (Array.from(description).length < 60) {
    description = `${description} 配色、季节与适用人群以已确认的信息为准，搭配方式可依个人偏好灵活调整，商品细节请以实际页面信息为准。`;
    adjusted = true;
  }
  if (Array.from(description).length > 100) {
    description = `${Array.from(description).slice(0, 99).join("")}。`;
    adjusted = true;
  }
  if (!adjusted) return value;

  const confidence = isRecord(value.confidence) ? value.confidence : {};
  const descriptionConfidence =
    typeof confidence.description === "number" &&
    Number.isFinite(confidence.description)
      ? Math.min(confidence.description, 0.4)
      : 0.4;
  const overallConfidence =
    typeof confidence.overall === "number" &&
    Number.isFinite(confidence.overall)
      ? Math.min(confidence.overall, 0.4)
      : 0.4;

  return {
    ...value,
    description,
    confidence: {
      description: descriptionConfidence,
      overall: overallConfidence,
    },
  };
}

async function requestVisionModel(
  image: Buffer,
  mime: string,
  apiKey: string,
  model: string,
  baseUrl: string,
  inputPricePerMillion: number,
  outputPricePerMillion: number,
): Promise<RecognizeResponse> {
  const imageBase64 = image.toString("base64");
  const endpoint = getChatCompletionsEndpoint(baseUrl);
  let repairPrompt: string | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchModelResponse(endpoint, apiKey, model, [
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
    ]);

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
    const usage = parseModelUsage(payload);
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
    if (result.success) {
      return {
        result: result.data,
        usage,
        costEstimate: calculateRecognitionCost(
          usage,
          inputPricePerMillion,
          outputPricePerMillion,
        ),
      };
    }
    repairPrompt = `上一次 JSON 未通过 schema 校验，请修复并只返回 JSON：${result.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ")}`;
    if (attempt === 1)
      failApi(422, "E_RECOGNIZE_INVALID", "视觉模型结果重试后仍未通过数据校验");
  }

  failApi(502, "E_UPSTREAM", "视觉模型结果重试后仍无法识别");
}

async function fetchModelResponse(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: "system" | "user"; content: unknown }>,
): Promise<Response> {
  let lastStatus: number | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model || "glm-4v-flash",
          temperature: 0.1,
          messages,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) return response;
      lastStatus = response.status;
      if (
        attempt === 0 &&
        (response.status === 429 || response.status >= 500)
      ) {
        await pauseBeforeRetry();
        continue;
      }
      if (response.status === 429)
        failApi(429, "E_RATE_LIMIT", "视觉模型请求频率超限");
      failApi(502, "E_UPSTREAM", `视觉模型返回 HTTP ${response.status}`);
    } catch (error) {
      if (isHttpError(error)) throw error;
      if (attempt === 0) {
        await pauseBeforeRetry();
        continue;
      }
      failApi(502, "E_UPSTREAM", "视觉模型请求失败或超时");
    }
  }
  failApi(
    502,
    "E_UPSTREAM",
    lastStatus
      ? `视觉模型重试后仍返回 HTTP ${lastStatus}`
      : "视觉模型请求失败或超时",
  );
}

function getChatCompletionsEndpoint(baseUrl: string): string {
  const configuredEndpoint = baseUrl || "https://open.bigmodel.cn/api/paas/v4";
  return /\/chat\/completions\/?$/i.test(configuredEndpoint)
    ? configuredEndpoint.replace(/\/+$/, "")
    : `${configuredEndpoint.replace(/\/+$/, "")}/chat/completions`;
}

function isHttpError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  );
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
