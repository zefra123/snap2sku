import Database from "better-sqlite3";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  ProductRecordSchema,
  type ProductRecord,
  type SKUItem,
} from "@scope/shared/schema";

const workingDirectory = process.cwd();
const defaultDataDirectory =
  basename(workingDirectory) === "web" &&
  basename(dirname(workingDirectory)) === "apps"
    ? resolve(workingDirectory, "../../data")
    : resolve(workingDirectory, "data");
const databaseFileName = "records.sqlite";
const legacyFileName = "records.json";
const backupFileName = "records.json.bak";

let database: Database | undefined;
let activeDataDirectory: string | undefined;

export function initializeStore(dataDirectory = defaultDataDirectory): void {
  const resolvedDirectory = resolve(dataDirectory);
  if (database) {
    if (resolvedDirectory !== activeDataDirectory) {
      throw new Error("store 已在其他数据目录初始化，请先关闭当前连接");
    }
    return;
  }

  mkdirSync(resolvedDirectory, { recursive: true });
  const connection = new Database(join(resolvedDirectory, databaseFileName));
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");
  connection.exec(`
    CREATE TABLE IF NOT EXISTS records (
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
    CREATE TABLE IF NOT EXISTS skus (
      record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
      color TEXT NOT NULL,
      size TEXT NOT NULL,
      stock INTEGER NOT NULL CHECK (stock >= 0),
      tag_price REAL NOT NULL CHECK (tag_price > 0),
      wholesale_price REAL NOT NULL CHECK (wholesale_price > 0),
      PRIMARY KEY (record_id, color, size)
    );
  `);
  database = connection;
  activeDataDirectory = resolvedDirectory;

  try {
    migrateLegacyJson(connection, resolvedDirectory);
  } catch (error) {
    connection.close();
    database = undefined;
    activeDataDirectory = undefined;
    throw error;
  }
}

export function closeStore(): void {
  database?.close();
  database = undefined;
  activeDataDirectory = undefined;
}

export async function ensureUploadDirectory(): Promise<void> {
  mkdirSync(uploadDirectory(), { recursive: true });
}

export function uploadPath(storedAs: string): string {
  return join(uploadDirectory(), basename(storedAs));
}

export async function findUploadPath(
  fileId: string,
): Promise<string | undefined> {
  await ensureUploadDirectory();
  const files = readdirSync(uploadDirectory());
  const match = files.find((file) => file.startsWith(`${fileId}.`));
  return match ? uploadPath(match) : undefined;
}

export async function readRecords(): Promise<ProductRecord[]> {
  const connection = getDatabase();
  const records = connection
    .prepare("SELECT * FROM records ORDER BY rowid")
    .all() as DatabaseRow[];
  const skuRows = connection
    .prepare("SELECT * FROM skus ORDER BY rowid")
    .all() as SkuRow[];
  const skusByRecord = new Map<string, SKUItem[]>();

  for (const row of skuRows) {
    const recordSkus = skusByRecord.get(row.record_id) ?? [];
    recordSkus.push({
      color: row.color,
      size: row.size,
      stock: row.stock,
      tagPrice: row.tag_price,
      wholesalePrice: row.wholesale_price,
    });
    skusByRecord.set(row.record_id, recordSkus);
  }

  return records.map((row) =>
    ProductRecordSchema.parse({
      id: row.id,
      createdAt: row.created_at,
      durationMs: parseJson(row.duration_ms),
      images: parseJson(row.images),
      recognize: parseJson(row.recognize),
      edits: parseJson(row.edits ?? "[]"),
      aiCorrect: parseJson(row.ai_correct ?? "{}"),
      costEstimate: row.cost_estimate,
      description: row.description,
      ...(row.description_ai === null
        ? {}
        : { descriptionAi: row.description_ai }),
      sku: skusByRecord.get(row.id) ?? [],
    }),
  );
}

export async function appendRecord(record: ProductRecord): Promise<void> {
  const connection = getDatabase();
  connection.exec("BEGIN IMMEDIATE");
  try {
    insertRecord(connection, record, false);
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

export async function saveGeneratedDescription(
  recordId: string,
  description: string,
): Promise<boolean> {
  const result = getDatabase()
    .prepare("UPDATE records SET description_ai = ? WHERE id = ?")
    .run(description, recordId);
  return result.changes > 0;
}

function getDatabase(): Database {
  if (!database) initializeStore();
  if (!database) throw new Error("store 初始化失败");
  return database;
}

function uploadDirectory(): string {
  return join(activeDataDirectory ?? defaultDataDirectory, "uploads");
}

function migrateLegacyJson(connection: Database, dataDirectory: string): void {
  const legacyPath = join(dataDirectory, legacyFileName);
  if (!existsSync(legacyPath)) return;

  const backupPath = join(dataDirectory, backupFileName);
  if (existsSync(backupPath)) {
    throw new Error(
      `${backupFileName} 已存在；为避免覆盖旧备份，中止 JSON 迁移`,
    );
  }

  const parsed: unknown = JSON.parse(readFileSync(legacyPath, "utf8"));
  if (!Array.isArray(parsed))
    throw new Error("records.json must contain an array");
  const records = parsed.map((item) => ProductRecordSchema.parse(item));

  connection.exec("BEGIN IMMEDIATE");
  try {
    for (const record of records) insertRecord(connection, record, true);
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }

  renameSync(legacyPath, backupPath);
}

function insertRecord(
  connection: Database,
  record: ProductRecord,
  ignoreExisting: boolean,
): void {
  const insertMode = ignoreExisting ? "OR IGNORE " : "";
  const result = connection
    .prepare(
      `
    INSERT ${insertMode}INTO records (
      id, created_at, duration_ms, images, recognize, edits, ai_correct,
      cost_estimate, description, description_ai
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      record.id,
      record.createdAt,
      JSON.stringify(record.durationMs),
      JSON.stringify(record.images),
      JSON.stringify(record.recognize),
      JSON.stringify(record.edits),
      JSON.stringify(record.aiCorrect),
      record.costEstimate,
      record.description,
      record.descriptionAi ?? null,
    );

  if (ignoreExisting && result.changes === 0) return;
  const insertSku = connection.prepare(`
    INSERT INTO skus (record_id, color, size, stock, tag_price, wholesale_price)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const sku of record.sku) {
    insertSku.run(
      record.id,
      sku.color,
      sku.size,
      sku.stock,
      sku.tagPrice,
      sku.wholesalePrice,
    );
  }
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

interface DatabaseRow {
  id: string;
  created_at: string;
  duration_ms: string;
  images: string;
  recognize: string;
  edits: string | null;
  ai_correct: string | null;
  cost_estimate: number;
  description: string;
  description_ai: string | null;
}

interface SkuRow {
  record_id: string;
  color: string;
  size: string;
  stock: number;
  tag_price: number;
  wholesale_price: number;
}
