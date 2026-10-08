import type { H3Event } from "h3";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProductRecord } from "@scope/shared/schema";
import { assertAccessCode } from "../../../utils/access-code";
import {
  closeStore,
  initializeStore,
  appendRecord,
  readRecords,
} from "../../../utils/store";
import { handleRecordDescription } from "./describe.post";

let temporaryDirectory: string | undefined;

afterEach(() => {
  closeStore();
  if (temporaryDirectory)
    rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

describe("POST /api/records/:id/describe", () => {
  it("按 schema 字段生成完整 mock SSE 流并保存描述", async () => {
    const directory = createTemporaryDirectory();
    initializeStore(directory);
    const record = createRecord();
    await appendRecord(record);
    const { event, chunks, response } = createEvent(record.id);

    await handleRecordDescription(event, { mock: true, chunkDelayMs: 0 });

    const stream = chunks.join("");
    const textFragments = Array.from(
      stream.matchAll(/event: chunk\ndata: (.+)\n\n/g),
      (match) => JSON.parse(match[1]!).text as string,
    );
    const savedRecord = (await readRecords())[0]!;
    const description = savedRecord.descriptionAi ?? "";

    expect(Array.from(description).length).toBeGreaterThanOrEqual(60);
    expect(Array.from(description).length).toBeLessThanOrEqual(100);
    expect(textFragments).toHaveLength(
      Math.ceil(Array.from(description).length / 10),
    );
    expect(textFragments.join("")).toBe(description);
    expect(stream).toContain('event: result\ndata: {"confidence":');
    expect(stream).toContain("event: done\ndata: [DONE]\n\n");
    expect(response.statusCode).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/event-stream; charset=utf-8",
    );
    expect(response.ended).toBe(true);
  });

  it("响应中途断开时不保存描述", async () => {
    initializeStore(createTemporaryDirectory());
    const record = createRecord();
    await appendRecord(record);
    const { event, chunks, response } = createEvent(record.id, true);

    await handleRecordDescription(event, { mock: true, chunkDelayMs: 0 });

    expect(chunks.join("")).not.toContain("event: done");
    expect(response.ended).toBe(false);
    await expect(readRecords()).resolves.toEqual([record]);
  });

  it("record 不存在时返回 404", async () => {
    initializeStore(createTemporaryDirectory());
    const { event } = createEvent("00000000-0000-4000-8000-000000000000");

    await expect(
      handleRecordDescription(event, { mock: true, chunkDelayMs: 0 }),
    ).rejects.toMatchObject({
      statusCode: 404,
      data: { code: "E_RECORD_NOT_FOUND" },
    });
  });

  it("缺少访问码返回 401", () => {
    let thrown: unknown;
    try {
      assertAccessCode("secret-code", "");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      statusCode: 401,
      data: { code: "E_ACCESS_CODE_REQUIRED" },
    });
  });
});

function createTemporaryDirectory(): string {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "snap2sku-describe-"));
  return temporaryDirectory;
}

function createEvent(
  recordId: string,
  destroyAfterFirstWrite = false,
): {
  event: H3Event;
  chunks: string[];
  response: ReturnType<typeof createResponse>;
} {
  const chunks: string[] = [];
  const response = createResponse(chunks, destroyAfterFirstWrite);
  const event = {
    context: { params: { id: recordId } },
    node: { res: response },
  } as unknown as H3Event;
  return { event, chunks, response };
}

function createResponse(chunks: string[], destroyAfterFirstWrite: boolean) {
  const headers = new Map<string, string>();
  return {
    statusCode: 0,
    destroyed: false,
    ended: false,
    headers,
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    getHeader(name: string) {
      return headers.get(name);
    },
    flushHeaders() {},
    write(chunk: string) {
      chunks.push(chunk);
      if (destroyAfterFirstWrite && chunks.length === 1) this.destroyed = true;
      return true;
    },
    end() {
      this.ended = true;
      return this;
    },
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
