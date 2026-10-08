import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProductRecord } from "@scope/shared/schema";
import {
  closeStore,
  initializeStore,
  readRecords,
  appendRecord,
} from "./store";

const temporaryDirectories: string[] = [];

afterEach(() => {
  closeStore();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite store", () => {
  it("新增并读取记录及其 SKU", async () => {
    const directory = createTemporaryDirectory();
    initializeStore(directory);
    const record = createRecord();

    await appendRecord(record);

    await expect(readRecords()).resolves.toEqual([record]);
  });

  it("删除记录时级联删除 SKU", async () => {
    const directory = createTemporaryDirectory();
    initializeStore(directory);
    const record = createRecord();
    await appendRecord(record);

    const database = new Database(join(directory, "records.sqlite"));
    database.pragma("foreign_keys = ON");
    database.prepare("DELETE FROM records WHERE id = ?").run(record.id);
    const skuCount = database
      .prepare("SELECT COUNT(*) AS count FROM skus")
      .get() as { count: number };
    database.close();

    expect(skuCount.count).toBe(0);
    await expect(readRecords()).resolves.toEqual([]);
  });

  it("完整迁移旧 JSON 并将原文件改名为 bak", async () => {
    const directory = createTemporaryDirectory();
    const record = createRecord({
      description: "迁移时保留的商品描述",
      descriptionAi: "AI 首次生成的描述",
    });
    const jsonPath = join(directory, "records.json");
    const backupPath = join(directory, "records.json.bak");
    writeFileSync(jsonPath, `${JSON.stringify([record])}\n`, "utf8");

    initializeStore(directory);

    await expect(readRecords()).resolves.toEqual([record]);
    expect(existsSync(jsonPath)).toBe(false);
    expect(JSON.parse(readFileSync(backupPath, "utf8"))).toEqual([record]);
  });

  it("并发追加记录时不丢数据", async () => {
    const directory = createTemporaryDirectory();
    initializeStore(directory);
    const records = Array.from({ length: 40 }, (_, index) =>
      createRecord({
        id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
        description: `并发记录 ${index}`,
      }),
    );

    await Promise.all(records.map((record) => appendRecord(record)));

    const savedRecords = await readRecords();
    expect(savedRecords).toHaveLength(records.length);
    expect(new Set(savedRecords.map((record) => record.id)).size).toBe(
      records.length,
    );
  });
});

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "snap2sku-store-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createRecord(overrides: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id: "b8d18f28-5964-4c9e-a2f8-0ae388a32d74",
    createdAt: "2026-10-08T00:00:00.000Z",
    durationMs: {
      uploadStart: 1_791_408_000_000,
      recognizedAt: 1_791_408_001_000,
      submittedAt: 1_791_408_002_000,
    },
    images: ["a0df5979-b3df-46c7-9c42-266729eb834b"],
    recognize: {
      category: "上衣",
      colors: [{ name: "藏青", hex: "#263A55" }],
      style: "休闲",
      seasons: ["秋"],
      audience: "中性",
      fabric: null,
      tagPrice: null,
      item_name: "藏青宽松休闲上衣",
      confidence: { category: 0.9, colors: 0.9, style: 0.9, overall: 0.9 },
    },
    edits: [
      { field: "category", from: "其他", to: "上衣", isCorrection: true },
    ],
    sku: [
      { color: "藏青", size: "M", stock: 4, tagPrice: 129, wholesalePrice: 58 },
      { color: "藏青", size: "L", stock: 3, tagPrice: 129, wholesalePrice: 58 },
    ],
    description: "日常穿着的宽松上衣",
    aiCorrect: { category: false },
    costEstimate: 0.012,
    ...overrides,
  };
}
