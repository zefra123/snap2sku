import type { H3Event } from "h3";
import { createError, defineEventHandler } from "h3";
import {
  DescribeResultSchema,
  DescriptionSourceSchema,
  type DescribeResult,
  type DescriptionSource,
} from "@scope/shared/schema";
import {
  DESCRIPTION_SYSTEM_PROMPT,
  buildDescriptionUserPrompt,
} from "@scope/prompts/describe";
import { getRecordById, saveGeneratedDescription } from "../../../utils/store";

const MOCK_CHUNK_SIZE = 10;
const MOCK_CHUNK_DELAY_MS = 200;

interface DescribeOptions {
  mock: boolean;
  chunkDelayMs?: number;
}

export default defineEventHandler((event) =>
  handleRecordDescription(event, {
    mock: String(useRuntimeConfig(event).visionMock ?? "0") === "1",
  }),
);

export async function handleRecordDescription(
  event: H3Event,
  options: DescribeOptions,
): Promise<void> {
  const recordId = event.context.params?.id;
  const record = recordId ? await getRecordById(recordId) : undefined;
  if (!record) {
    throw createError({
      statusCode: 404,
      statusMessage: "E_RECORD_NOT_FOUND: 找不到这条商品记录",
      data: { code: "E_RECORD_NOT_FOUND", message: "找不到这条商品记录" },
    });
  }

  if (!options.mock) {
    throw createError({
      statusCode: 503,
      statusMessage: "E_DESCRIPTION_UNAVAILABLE: 描述生成服务尚未启用",
      data: {
        code: "E_DESCRIPTION_UNAVAILABLE",
        message: "描述生成服务尚未启用，请设置 NUXT_VISION_MOCK=1 使用本地示例",
      },
    });
  }

  const source = DescriptionSourceSchema.parse(record.recognize);
  const prompt = {
    system: DESCRIPTION_SYSTEM_PROMPT,
    user: buildDescriptionUserPrompt(source),
  };
  const result = createMockDescriptionResult(source, prompt);
  const completed = await writeDescriptionStream(
    event,
    result,
    options.chunkDelayMs ?? MOCK_CHUNK_DELAY_MS,
  );
  if (!completed) return;

  if (!(await saveGeneratedDescription(record.id, result.description))) {
    throw createError({
      statusCode: 500,
      statusMessage: "E_WRITE_FAILED: 描述保存失败，请稍后重试",
      data: { code: "E_WRITE_FAILED", message: "描述保存失败，请稍后重试" },
    });
  }
}

export function createMockDescriptionResult(
  source: DescriptionSource,
  prompt: { system: string; user: string },
): DescribeResult {
  if (!prompt.system || !prompt.user) throw new Error("描述 prompt 不能为空");

  const colors = source.colors
    .slice(0, 2)
    .map((color) => color.name)
    .join("、");
  const seasons = source.seasons.slice(0, 2).join("、");
  const copy = `这款${source.style}风格的${source.category}版型利落，${colors}配色耐看，适合${seasons}季${source.audience}日常穿着。搭配基础上衣或下装都很协调，可轻松应对通勤、出行与周末休闲场景。整体设计简洁实用，单穿叠搭都自然，为日常造型增添舒适感与层次感。`;
  const description = fitDescriptionLength(copy);
  return DescribeResultSchema.parse({
    description,
    confidence: { description: 0.88, overall: 0.88 },
  });
}

export async function writeDescriptionStream(
  event: H3Event,
  result: DescribeResult,
  chunkDelayMs = MOCK_CHUNK_DELAY_MS,
): Promise<boolean> {
  const response = event.node.res;
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders();

  for (const text of splitText(result.description, MOCK_CHUNK_SIZE)) {
    if (response.destroyed) return false;
    response.write(`event: chunk\ndata: ${JSON.stringify({ text })}\n\n`);
    if (chunkDelayMs > 0) await delay(chunkDelayMs);
  }

  if (response.destroyed) return false;
  response.write(
    `event: result\ndata: ${JSON.stringify({ confidence: result.confidence })}\n\n`,
  );
  response.write("event: done\ndata: [DONE]\n\n");
  response.end();
  return true;
}

function splitText(text: string, chunkSize: number): string[] {
  const characters = Array.from(text);
  const chunks: string[] = [];
  for (let offset = 0; offset < characters.length; offset += chunkSize) {
    chunks.push(characters.slice(offset, offset + chunkSize).join(""));
  }
  return chunks;
}

function fitDescriptionLength(text: string): string {
  const characters = Array.from(text);
  if (characters.length <= 100) return text;
  return `${characters.slice(0, 99).join("")}。`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
