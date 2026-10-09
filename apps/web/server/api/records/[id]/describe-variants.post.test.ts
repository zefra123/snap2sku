import type { H3Event } from "h3";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProductRecord } from "@scope/shared/schema";
import {
  closeStore,
  initializeStore,
  appendRecord,
  readRecords,
} from "../../../utils/store";
import { createMockDescriptionVariants } from "../../../utils/vision";
import { handleDescriptionVariants } from "./describe-variants.post";

let directory: string | undefined;
afterEach(() => {
  closeStore();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("POST /api/records/:id/describe-variants", () => {
  it("streams three mock platforms and saves variants without cost", async () => {
    initializeStore(createDirectory());
    const record = createRecord();
    record.costEstimate = 0.012;
    await appendRecord(record);
    const { event, chunks, response } = createEvent(record.id);
    await handleDescriptionVariants(event, { mock: true, chunkDelayMs: 0 });
    const stream = chunks.join("");
    expect(stream).toContain('"platform":"douyin"');
    expect(stream).toContain('"platform":"xiaohongshu"');
    expect(stream).toContain('"platform":"shipinhao"');
    expect(stream).toContain(
      '"confidence":{"description":0.88,"overall":0.88}',
    );
    expect(stream).toContain("event: done\ndata: [DONE]\n\n");
    expect(response.ended).toBe(true);
    await expect(readRecords()).resolves.toMatchObject([
      {
        costEstimate: 0.012,
        descriptionVariantsAi: { douyin: {}, xiaohongshu: {}, shipinhao: {} },
      },
    ]);
  });

  it("clamps model confidence in all platform result events to 0.6", async () => {
    initializeStore(createDirectory());
    const record = createRecord();
    await appendRecord(record);
    const { event, chunks } = createEvent(record.id);
    const mockVariants = createMockDescriptionVariants(record.recognize);
    await handleDescriptionVariants(event, {
      mock: false,
      generate: async () => ({
        result: {
          douyin: {
            ...mockVariants.douyin,
            confidence: { description: 1, overall: 0.9 },
          },
          xiaohongshu: {
            ...mockVariants.xiaohongshu,
            confidence: { description: 0.7, overall: 1 },
          },
          shipinhao: {
            ...mockVariants.shipinhao,
            confidence: { description: 0.5, overall: 0.8 },
          },
        },
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        costEstimate: 0.004,
      }),
    });

    const resultEvents = Array.from(
      chunks.join("").matchAll(/event: result\ndata: (.+)\n\n/g),
      (match) =>
        JSON.parse(match[1]!) as {
          confidence: { description: number; overall: number };
        },
    );
    expect(resultEvents).toHaveLength(3);
    expect(resultEvents.map(({ confidence }) => confidence)).toEqual([
      { description: 0.6, overall: 0.6 },
      { description: 0.6, overall: 0.6 },
      { description: 0.5, overall: 0.6 },
    ]);
  });

  it("does not save variants or add model cost when the stream disconnects", async () => {
    initializeStore(createDirectory());
    const record = createRecord();
    record.costEstimate = 0.012;
    await appendRecord(record);
    const { event, chunks } = createEvent(record.id, true);
    await handleDescriptionVariants(event, {
      mock: false,
      generate: async () => ({
        result: createMockDescriptionVariants(record.recognize),
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        costEstimate: 0.004,
      }),
    });
    expect(chunks.join("")).not.toContain("event: done");
    await expect(readRecords()).resolves.toMatchObject([
      { costEstimate: 0.012 },
    ]);
    expect((await readRecords())[0]?.descriptionVariantsAi).toBeUndefined();
  });
});

function createDirectory(): string {
  directory = mkdtempSync(join(tmpdir(), "snap2sku-variants-"));
  return directory;
}
function createEvent(id: string, disconnect = false) {
  const chunks: string[] = [];
  const headers = new Map<string, string>();
  const response = {
    statusCode: 0,
    destroyed: false,
    ended: false,
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    flushHeaders() {},
    write(chunk: string) {
      chunks.push(chunk);
      if (disconnect && chunks.length === 1) this.destroyed = true;
      return true;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
  return {
    chunks,
    response,
    event: {
      context: { params: { id } },
      node: { res: response },
    } as unknown as H3Event,
  };
}
function createRecord(): ProductRecord {
  return {
    id: "b8d18f28-5964-4c9e-a2f8-0ae388a32d74",
    createdAt: "2026-10-09T00:00:00.000Z",
    durationMs: { uploadStart: 1, recognizedAt: 2, submittedAt: 3 },
    images: ["a0df5979-b3df-46c7-9c42-266729eb834b"],
    recognize: {
      category: "外套",
      colors: [{ name: "藏青", hex: "#263A55" }],
      style: "通勤",
      seasons: ["春", "秋"],
      audience: "女",
      fabric: null,
      tagPrice: null,
      item_name: "藏青简约通勤外套",
      confidence: { category: 0.9, colors: 0.9, style: 0.9, overall: 0.9 },
    },
    edits: [],
    sku: [
      {
        color: "藏青",
        size: "M",
        stock: 3,
        tagPrice: 299,
        wholesalePrice: 120,
      },
    ],
    description: "",
    aiCorrect: {},
    costEstimate: 0,
  };
}
