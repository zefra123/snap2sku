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
import { resolve } from "node:path";
import type { ProductRecord } from "@scope/shared/schema";
import { DescriptionSourceSchema } from "@scope/shared/schema";
import {
  closeStore,
  initializeStore,
  readRecords,
  getRecordById,
  appendRecord,
  saveGeneratedDescription,
  saveGeneratedDescriptionVariants,
  updateRecordDetails,
  resolveDataDirectory,
} from "./store";

const temporaryDirectories: string[] = [];

afterEach(() => {
  closeStore();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite store", () => {
  it("解析显式数据目录并在未配置时回退到默认目录", () => {
    expect(resolveDataDirectory("/opt/snap2sku/data")).toBe(
      resolve("/opt/snap2sku/data"),
    );
    expect(resolveDataDirectory("data")).toBe(resolve("data"));
    expect(resolveDataDirectory("")).toBe(resolveDataDirectory());
    expect(resolveDataDirectory(undefined)).toBe(resolveDataDirectory());
    expect(resolveDataDirectory("   ")).toBe(resolveDataDirectory());
  });

  it("为现有 SQLite 数据库迁移详情版本列", async () => {
    const directory = createTemporaryDirectory();
    const database = new Database(join(directory, "records.sqlite"));
    database.exec(`
      CREATE TABLE records (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        duration_ms TEXT NOT NULL,
        images TEXT NOT NULL,
        recognize TEXT NOT NULL,
        edits TEXT,
        ai_correct TEXT,
        cost_estimate REAL NOT NULL DEFAULT 0,
        description TEXT NOT NULL,
        description_ai TEXT
      );
    `);
    database.close();

    initializeStore(directory);

    const migrated = new Database(join(directory, "records.sqlite"));
    const columns = migrated
      .prepare("PRAGMA table_info(records)")
      .all() as Array<{ name: string }>;
    migrated.close();
    expect(columns.map((column) => column.name)).toContain("details_version");
    expect(columns.map((column) => column.name)).toContain(
      "description_variants_ai",
    );
  });

  it("新增并读取记录及其 SKU", async () => {
    const directory = createTemporaryDirectory();
    initializeStore(directory);
    const record = createRecord();

    await appendRecord(record);

    await expect(readRecords()).resolves.toEqual([record]);
  });

  it("持久化并读取多平台文案", async () => {
    initializeStore(createTemporaryDirectory());
    const record = createRecord();
    await appendRecord(record);
    const variants = {
      douyin: {
        description: "抖音文案".repeat(15),
        confidence: { description: 0.8, overall: 0.8 },
      },
      xiaohongshu: {
        description: "小红书文案".repeat(15),
        confidence: { description: 0.8, overall: 0.8 },
      },
      shipinhao: {
        description: "视频号文案".repeat(15),
        confidence: { description: 0.8, overall: 0.8 },
      },
    };
    await saveGeneratedDescriptionVariants(
      record.id,
      DescriptionSourceSchema.parse(record.recognize),
      variants,
      0.003,
    );
    await expect(getRecordById(record.id)).resolves.toMatchObject({
      descriptionVariantsAi: variants,
      costEstimate: 0.015,
    });
  });

  it("保存详情页人工修正并追加修正流水", async () => {
    initializeStore(createTemporaryDirectory());
    const record = createRecord();
    await appendRecord(record);
    const recognize = {
      ...record.recognize,
      fabric: "棉混纺",
    };
    const sku = record.sku.map((item) => ({
      ...item,
      tagPrice: item.tagPrice + 10,
    }));

    const result = await updateRecordDetails(
      record.id,
      record.detailsVersion,
      recognize,
      sku,
    );
    expect(result.kind).toBe("updated");
    if (result.kind !== "updated") throw new Error("record update failed");
    const updated = result.record;

    expect(updated.recognize.fabric).toBe("棉混纺");
    expect(updated.sku[0]?.tagPrice).toBe(139);
    expect(updated.detailsVersion).toBe(1);
    expect(updated.edits).toContainEqual({
      field: "fabric",
      from: null,
      to: "棉混纺",
      isCorrection: true,
    });
    expect(updated.edits).toContainEqual({
      field: "sku:藏青/M:tagPrice",
      from: 129,
      to: 139,
      isCorrection: true,
    });
    expect(updated.aiCorrect.fabric).toBe(false);
  });

  it("文案来源字段变化时清空 AI 文案，但保留手工描述和累计成本", async () => {
    initializeStore(createTemporaryDirectory());
    const record = createRecord({
      descriptionAi: "旧 AI 文案",
      descriptionVariantsAi: createDescriptionVariants(),
    });
    await appendRecord(record);
    const recognize = { ...record.recognize, category: "外套" as const };

    const result = await updateRecordDetails(
      record.id,
      record.detailsVersion,
      recognize,
      record.sku,
    );

    expect(result.kind).toBe("updated");
    if (result.kind !== "updated") throw new Error("record update failed");
    expect(result.record.descriptionAi).toBeUndefined();
    expect(result.record.descriptionVariantsAi).toBeUndefined();
    expect(result.record.description).toBe(record.description);
    expect(result.record.costEstimate).toBe(record.costEstimate);
  });

  it("非文案来源字段变化不清空 AI 文案", async () => {
    initializeStore(createTemporaryDirectory());
    const record = createRecord({
      descriptionAi: "仍然有效的 AI 文案",
      descriptionVariantsAi: createDescriptionVariants(),
    });
    await appendRecord(record);

    const result = await updateRecordDetails(
      record.id,
      record.detailsVersion,
      { ...record.recognize, fabric: "棉混纺" },
      record.sku,
    );

    expect(result.kind).toBe("updated");
    if (result.kind !== "updated") throw new Error("record update failed");
    expect(result.record.descriptionAi).toBe(record.descriptionAi);
    expect(result.record.descriptionVariantsAi).toEqual(
      record.descriptionVariantsAi,
    );
  });

  it("过期详情版本不覆盖新资料且不追加流水", async () => {
    initializeStore(createTemporaryDirectory());
    const record = createRecord();
    await appendRecord(record);
    const firstEdit = await updateRecordDetails(
      record.id,
      record.detailsVersion,
      { ...record.recognize, fabric: "棉混纺" },
      record.sku,
    );
    expect(firstEdit.kind).toBe("updated");
    if (firstEdit.kind !== "updated") throw new Error("first update failed");

    const staleResult = await updateRecordDetails(
      record.id,
      record.detailsVersion,
      { ...record.recognize, fabric: "羊毛" },
      record.sku,
    );

    expect(staleResult).toEqual({ kind: "conflict" });
    await expect(getRecordById(record.id)).resolves.toMatchObject({
      detailsVersion: 1,
      recognize: { fabric: "棉混纺" },
      edits: expect.arrayContaining([
        { field: "fabric", from: null, to: "棉混纺", isCorrection: true },
      ]),
    });
  });

  it("来源资料更新后拒绝保存旧版本生成中的 AI 文案", async () => {
    initializeStore(createTemporaryDirectory());
    const record = createRecord();
    await appendRecord(record);
    const changed = await updateRecordDetails(
      record.id,
      record.detailsVersion,
      { ...record.recognize, colors: [{ name: "米白", hex: "#F4F0E8" }] },
      record.sku,
    );
    expect(changed.kind).toBe("updated");

    await expect(
      saveGeneratedDescription(
        record.id,
        DescriptionSourceSchema.parse(record.recognize),
        "旧版本生成文案".repeat(10),
        0.02,
      ),
    ).resolves.toBe(false);
    const saved = await getRecordById(record.id);
    expect(saved?.detailsVersion).toBe(1);
    expect(saved?.costEstimate).toBe(record.costEstimate);
    expect(saved?.descriptionAi).toBeUndefined();
  });

  it("按 ID 读取单条记录且不会解析其他脏记录", async () => {
    const directory = createTemporaryDirectory();
    initializeStore(directory);
    const record = createRecord();
    const unrelatedRecord = createRecord({
      id: "00000000-0000-4000-8000-000000000042",
    });
    await appendRecord(record);
    await appendRecord(unrelatedRecord);

    const database = new Database(join(directory, "records.sqlite"));
    database
      .prepare("UPDATE records SET recognize = ? WHERE id = ?")
      .run("invalid json", unrelatedRecord.id);
    database.close();

    await expect(getRecordById(record.id)).resolves.toEqual(record);
  });

  it("按 ID 查询未命中时返回 undefined", async () => {
    initializeStore(createTemporaryDirectory());

    await expect(
      getRecordById("00000000-0000-4000-8000-000000000042"),
    ).resolves.toBeUndefined();
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

  // better-sqlite3 是同步 API + Node 单线程，Promise.all 不会产生真并发；
  // 本用例验证的是「连续追加 40 条不丢数据」，而非并发写入安全。
  it("连续追加 40 条记录不丢数据", async () => {
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
    detailsVersion: 0,
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

function createDescriptionVariants(): NonNullable<
  ProductRecord["descriptionVariantsAi"]
> {
  return {
    douyin: {
      description: "抖音文案".repeat(15),
      confidence: { description: 0.8, overall: 0.8 },
    },
    xiaohongshu: {
      description: "小红书文案".repeat(15),
      confidence: { description: 0.8, overall: 0.8 },
    },
    shipinhao: {
      description: "视频号文案".repeat(15),
      confidence: { description: 0.8, overall: 0.8 },
    },
  };
}
