import type { H3Event } from "h3";
import { createError, defineEventHandler } from "h3";
import {
  DescriptionSourceSchema,
  type DescriptionPlatform,
} from "@scope/shared/schema";
import {
  createMockDescriptionVariants,
  describeProductVariants,
} from "../../../utils/vision";
import type { DescriptionVariantsGeneration } from "../../../utils/vision";
import {
  getRecordById,
  saveGeneratedDescriptionVariants,
} from "../../../utils/store";

const PLATFORMS: DescriptionPlatform[] = ["douyin", "xiaohongshu", "shipinhao"];
const PLATFORM_LABELS: Record<DescriptionPlatform, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  shipinhao: "视频号",
};

interface Options {
  mock: boolean;
  chunkDelayMs?: number;
  generate?: (
    source: unknown,
    event: H3Event,
  ) => Promise<DescriptionVariantsGeneration>;
}

export default defineEventHandler((event) =>
  handleDescriptionVariants(event, {
    mock: String(useRuntimeConfig(event).visionMock ?? "0") === "1",
    generate: describeProductVariants,
  }),
);

export async function handleDescriptionVariants(
  event: H3Event,
  options: Options,
): Promise<void> {
  const id = event.context.params?.id;
  const record = id ? await getRecordById(id) : undefined;
  if (!record)
    throw createError({
      statusCode: 404,
      statusMessage: "E_RECORD_NOT_FOUND: 找不到这条商品记录",
      data: { code: "E_RECORD_NOT_FOUND", message: "找不到这条商品记录" },
    });

  const source = DescriptionSourceSchema.parse(record.recognize);
  const generated = options.mock
    ? { result: createMockDescriptionVariants(source), costEstimate: 0 }
    : await (options.generate ?? describeProductVariants)(source, event);
  const variants = generated.result;
  const response = event.node.res;
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders();

  for (const platform of PLATFORMS) {
    const result = variants[platform];
    for (const text of splitText(result.description, 10)) {
      if (response.destroyed) return;
      response.write(
        `event: chunk\ndata: ${JSON.stringify({ platform, text })}\n\n`,
      );
      if (options.mock && (options.chunkDelayMs ?? 200) > 0)
        await delay(options.chunkDelayMs ?? 200);
    }
    if (response.destroyed) return;
    response.write(
      `event: result\ndata: ${JSON.stringify({ platform, platformLabel: PLATFORM_LABELS[platform], confidence: result.confidence, descriptionCostEstimate: platform === "shipinhao" ? generated.costEstimate : 0, costEstimate: record.costEstimate + (platform === "shipinhao" ? generated.costEstimate : 0) })}\n\n`,
    );
  }
  if (response.destroyed) return;
  response.write("event: done\ndata: [DONE]\n\n");
  response.end();

  if (
    !(await saveGeneratedDescriptionVariants(
      record.id,
      variants,
      generated.costEstimate,
    ))
  ) {
    throw createError({
      statusCode: 500,
      statusMessage: "E_WRITE_FAILED: 描述保存失败，请稍后重试",
      data: { code: "E_WRITE_FAILED", message: "描述保存失败，请稍后重试" },
    });
  }
}

function splitText(value: string, size: number): string[] {
  const characters = Array.from(value);
  return Array.from(
    { length: Math.ceil(characters.length / size) },
    (_, index) => characters.slice(index * size, (index + 1) * size).join(""),
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
