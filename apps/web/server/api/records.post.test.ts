import { createError, type H3Event } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ProductRecord } from "@scope/shared/schema";
import {
  closeStore,
  initializeStore,
  readRecords,
  uploadPath,
} from "../utils/store";
import { handleCreateRecord } from "./records.post";

let temporaryDirectory: string | undefined;

beforeEach(() => {
  vi.stubGlobal("createError", createError);
});

afterEach(() => {
  vi.unstubAllGlobals();
  closeStore();
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  temporaryDirectory = undefined;
});

describe("POST /api/records image validation", () => {
  it("returns 201 and persists a record when its uploaded image exists", async () => {
    initializeStore(createTemporaryDirectory());
    const record = createRecord();
    createUploadedImage(record.images[0]!);
    const event = createEvent();

    const response = await handleCreateRecord(event, record);

    expect(event.node.res.statusCode).toBe(201);
    expect(response).toMatchObject({ id: record.id, detailsVersion: 0 });
    await expect(readRecords()).resolves.toMatchObject([{ id: record.id }]);
  });

  it("rejects a missing uploaded image without changing the database", async () => {
    initializeStore(createTemporaryDirectory());
    const record = createRecord();

    await expect(
      handleCreateRecord(createEvent(), record),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: {
        code: "E_IMAGE_MISSING",
        message: "有图片已失效，请重新上传后再提交",
      },
    });
    await expect(readRecords()).resolves.toEqual([]);
  });

  it("does not partially persist when one of two uploaded images is missing", async () => {
    initializeStore(createTemporaryDirectory());
    const record = createRecord();
    const existingImageId = record.images[0]!;
    createUploadedImage(existingImageId);
    record.images.push("d6bf018a-8875-42c5-b4b0-529f52336e70");

    await expect(
      handleCreateRecord(createEvent(), record),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { code: "E_IMAGE_MISSING" },
    });
    await expect(readRecords()).resolves.toEqual([]);
  });

  it("rejects records containing more than five images", async () => {
    initializeStore(createTemporaryDirectory());
    const record = createRecord();
    record.images = [
      "a0df5979-b3df-46c7-9c42-266729eb834b",
      "627c32ec-9844-49e9-90d8-0d1c1c90156c",
      "d6bf018a-8875-42c5-b4b0-529f52336e70",
      "5324c5c5-f57f-47ca-8e5f-a5cc9d7bff3d",
      "43e562ab-7f6a-4cce-9673-52ad3d748d22",
      "e37d4445-88ab-4f71-a27b-5d2721e13e9b",
    ];

    await expect(
      handleCreateRecord(createEvent(), record),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { code: "E_VALIDATION" },
    });
    await expect(readRecords()).resolves.toEqual([]);
  });
});

function createTemporaryDirectory(): string {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "snap2sku-record-post-"));
  return temporaryDirectory;
}

function createUploadedImage(fileId: string): void {
  const path = uploadPath(`${fileId}.jpg`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from([0xff, 0xd8, 0xff]));
}

function createEvent(): H3Event {
  return {
    node: {
      res: {
        statusCode: 0,
        setHeader() {},
        getHeader() {},
      },
    },
  } as unknown as H3Event;
}

function createRecord(): ProductRecord {
  return {
    id: "b8d18f28-5964-4c9e-a2f8-0ae388a32d74",
    detailsVersion: 0,
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
