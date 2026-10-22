import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  DescriptionSourceSchema,
  ProductRecordSchema,
  type ProductRecord,
  type DescriptionSource,
  type SKUItem,
} from "@scope/shared/schema";

const workingDirectory = process.cwd();
const defaultDataDirectory =
  basename(workingDirectory) === "web" &&
  basename(dirname(workingDirectory)) === "apps"
    ? resolve(workingDirectory, "../../data")
    : resolve(workingDirectory, "data");

export function resolveDataDirectory(configured?: unknown): string {
  const explicit = String(configured ?? "").trim();
  return explicit ? resolve(explicit) : defaultDataDirectory;
}

const databaseFileName = "records.sqlite";
const legacyFileName = "records.json";
const backupFileName = "records.json.bak";

export type ModelSpendKind = "recognize" | "describe" | "describeVariants";
export type ModelSpendStatus = "reserved" | "settled" | "released" | "unknown";

export interface ModelSpendSummary {
  spentCny: number;
  reservedCny: number;
  pendingReconcile: number;
}

export interface PendingModelSpend {
  id: string;
  createdAt: string;
  kind: ModelSpendKind;
  recordId: string | null;
  trialId: string | null;
  reservedCny: number;
  note: string | null;
}

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
  connection.pragma("busy_timeout = 5000");
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");
  connection.exec(`
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      details_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      duration_ms TEXT NOT NULL,
      images TEXT NOT NULL,
      recognize TEXT NOT NULL,
      edits TEXT,
      ai_correct TEXT,
      cost_estimate REAL NOT NULL DEFAULT 0,
      description TEXT NOT NULL,
      description_ai TEXT,
      description_variants_ai TEXT
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
    CREATE TABLE IF NOT EXISTS model_spend (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      kind TEXT NOT NULL,
      record_id TEXT,
      trial_id TEXT,
      mode TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('reserved', 'settled', 'released', 'unknown')),
      reserved_cny REAL NOT NULL CHECK (reserved_cny > 0),
      cost_cny REAL NOT NULL DEFAULT 0 CHECK (cost_cny >= 0),
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      estimated INTEGER NOT NULL DEFAULT 1 CHECK (estimated IN (0, 1)),
      expires_at TEXT,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS model_spend_status_idx ON model_spend(status);
    CREATE INDEX IF NOT EXISTS model_spend_kind_status_created_idx
      ON model_spend(kind, status, created_at DESC);
  `);
  const recordColumns = connection
    .prepare("PRAGMA table_info(records)")
    .all() as Array<{ name: string }>;
  if (
    !recordColumns.some((column) => column.name === "description_variants_ai")
  ) {
    connection.exec(
      "ALTER TABLE records ADD COLUMN description_variants_ai TEXT",
    );
  }
  if (!recordColumns.some((column) => column.name === "details_version")) {
    connection.exec(
      "ALTER TABLE records ADD COLUMN details_version INTEGER NOT NULL DEFAULT 0",
    );
  }
  connection
    .prepare(
      `UPDATE model_spend
       SET status = 'unknown', note = '服务重启时发现未完成的模型调用，需人工对账'
       WHERE status = 'reserved'`,
    )
    .run();
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

export function reserveModelSpend(input: {
  kind: ModelSpendKind;
  recordId?: string;
  trialId?: string;
  capCny: number;
  reserveCny: number;
}): { id: string; reservedCny: number; usedCny: number } | undefined {
  if (!Number.isFinite(input.capCny) || input.capCny <= 0) {
    throw new Error("trial budget cap 必须是有限正数");
  }
  if (!Number.isFinite(input.reserveCny) || input.reserveCny <= 0) {
    throw new Error("model spend reserve 必须是有限正数");
  }

  const connection = getDatabase();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const totals = connection
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'settled' THEN cost_cny ELSE 0 END), 0) AS spent_cny,
           COALESCE(SUM(CASE WHEN status IN ('reserved', 'unknown') THEN reserved_cny ELSE 0 END), 0) AS reserved_cny
         FROM model_spend`,
      )
      .get() as { spent_cny: number; reserved_cny: number };
    const usedCny = totals.spent_cny + totals.reserved_cny;
    if (usedCny + input.reserveCny > input.capCny + 1e-9) {
      connection.exec("ROLLBACK");
      return undefined;
    }

    const id = randomUUID();
    connection
      .prepare(
        `INSERT INTO model_spend
          (id, created_at, kind, record_id, trial_id, mode, status, reserved_cny)
         VALUES (?, ?, ?, ?, ?, 'real', 'reserved', ?)`,
      )
      .run(
        id,
        new Date().toISOString(),
        input.kind,
        input.recordId ?? null,
        input.trialId ?? null,
        input.reserveCny,
      );
    connection.exec("COMMIT");
    return { id, reservedCny: input.reserveCny, usedCny };
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

export function extendModelSpend(
  id: string,
  extraCny: number,
  capCny: number,
): boolean {
  if (!Number.isFinite(extraCny) || extraCny <= 0) {
    throw new Error("model spend extension 必须是有限正数");
  }
  if (!Number.isFinite(capCny) || capCny <= 0) {
    throw new Error("trial budget cap 必须是有限正数");
  }

  const connection = getDatabase();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const totals = connection
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'settled' THEN cost_cny ELSE 0 END), 0) AS spent_cny,
           COALESCE(SUM(CASE WHEN status IN ('reserved', 'unknown') THEN reserved_cny ELSE 0 END), 0) AS reserved_cny
         FROM model_spend`,
      )
      .get() as { spent_cny: number; reserved_cny: number };
    if (totals.spent_cny + totals.reserved_cny + extraCny > capCny + 1e-9) {
      connection.exec("ROLLBACK");
      return false;
    }

    const updated = connection
      .prepare(
        `UPDATE model_spend
         SET reserved_cny = reserved_cny + ?,
             note = CASE WHEN note IS NULL OR note = '' THEN '追加预占 1 次' ELSE note || '；追加预占 1 次' END
         WHERE id = ? AND status = 'reserved'`,
      )
      .run(extraCny, id);
    connection.exec(updated.changes === 1 ? "COMMIT" : "ROLLBACK");
    return updated.changes === 1;
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

export function recentSettledSpendCny(kind: ModelSpendKind): number[] {
  return (
    getDatabase()
      .prepare(
        "SELECT cost_cny FROM model_spend WHERE kind = ? AND status = 'settled' ORDER BY created_at DESC LIMIT 20",
      )
      .all(kind) as Array<{ cost_cny: number }>
  ).map((row) => row.cost_cny);
}

export function settleModelSpend(
  id: string,
  result: {
    promptTokens: number;
    completionTokens: number;
    costCny: number;
    estimated: boolean;
    note?: string;
  },
): void {
  const updated = getDatabase()
    .prepare(
      `UPDATE model_spend
       SET status = 'settled', cost_cny = ?, prompt_tokens = ?, completion_tokens = ?, estimated = ?, note = ?
       WHERE id = ? AND status = 'reserved'`,
    )
    .run(
      result.costCny,
      result.promptTokens,
      result.completionTokens,
      result.estimated ? 1 : 0,
      result.note ?? null,
      id,
    );
  if (updated.changes !== 1)
    throw new Error("model spend 不再处于 reserved 状态");
}

export function releaseModelSpend(id: string, reason: string): void {
  // 调用方必须能证明尚未发出模型请求；任何请求状态不明都必须标为 unknown。
  const updated = getDatabase()
    .prepare(
      "UPDATE model_spend SET status = 'released', note = ? WHERE id = ? AND status = 'reserved'",
    )
    .run(reason, id);
  if (updated.changes !== 1) throw new Error("只能释放 reserved model spend");
}

export function markModelSpendUnknown(id: string, reason: string): void {
  const updated = getDatabase()
    .prepare(
      "UPDATE model_spend SET status = 'unknown', note = ? WHERE id = ? AND status = 'reserved'",
    )
    .run(reason, id);
  if (updated.changes !== 1)
    throw new Error("只能将 reserved model spend 标为 unknown");
}

export function modelSpendSummary(): ModelSpendSummary {
  const row = getDatabase()
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'settled' THEN cost_cny ELSE 0 END), 0) AS spent_cny,
         COALESCE(SUM(CASE WHEN status IN ('reserved', 'unknown') THEN reserved_cny ELSE 0 END), 0) AS reserved_cny,
         COALESCE(SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END), 0) AS pending_reconcile
       FROM model_spend`,
    )
    .get() as {
    spent_cny: number;
    reserved_cny: number;
    pending_reconcile: number;
  };
  return {
    spentCny: row.spent_cny,
    reservedCny: row.reserved_cny,
    pendingReconcile: row.pending_reconcile,
  };
}

export function pendingModelSpends(): PendingModelSpend[] {
  return (
    getDatabase()
      .prepare(
        `SELECT id, created_at, kind, record_id, trial_id, reserved_cny, note
       FROM model_spend WHERE status = 'unknown' ORDER BY created_at`,
      )
      .all() as Array<{
      id: string;
      created_at: string;
      kind: ModelSpendKind;
      record_id: string | null;
      trial_id: string | null;
      reserved_cny: number;
      note: string | null;
    }>
  ).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    kind: row.kind,
    recordId: row.record_id,
    trialId: row.trial_id,
    reservedCny: row.reserved_cny,
    note: row.note,
  }));
}

export function reconcileModelSpend(
  id: string,
  decision: "settled" | "released",
): boolean {
  const connection = getDatabase();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const updated = connection
      .prepare(
        `UPDATE model_spend
         SET status = ?, cost_cny = CASE WHEN ? = 'settled' THEN reserved_cny ELSE 0 END,
             estimated = 1, note = ?
         WHERE id = ? AND status = 'unknown'`,
      )
      .run(
        decision,
        decision,
        `人工对账：${decision === "settled" ? "按预占金额记账" : "确认未计费"}`,
        id,
      );
    connection.exec(updated.changes === 1 ? "COMMIT" : "ROLLBACK");
    return updated.changes === 1;
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
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
      detailsVersion: row.details_version,
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
      ...(row.description_variants_ai === null
        ? {}
        : { descriptionVariantsAi: parseJson(row.description_variants_ai) }),
      sku: skusByRecord.get(row.id) ?? [],
    }),
  );
}

export async function getRecordById(
  recordId: string,
): Promise<ProductRecord | undefined> {
  return readRecordById(recordId);
}

function readRecordById(recordId: string): ProductRecord | undefined {
  const connection = getDatabase();
  const row = connection
    .prepare("SELECT * FROM records WHERE id = ?")
    .get(recordId) as DatabaseRow | undefined;
  if (!row) return undefined;

  const skuRows = connection
    .prepare("SELECT * FROM skus WHERE record_id = ? ORDER BY rowid")
    .all(recordId) as SkuRow[];
  const sku = skuRows.map((skuRow) => ({
    color: skuRow.color,
    size: skuRow.size,
    stock: skuRow.stock,
    tagPrice: skuRow.tag_price,
    wholesalePrice: skuRow.wholesale_price,
  }));

  return ProductRecordSchema.parse({
    id: row.id,
    detailsVersion: row.details_version,
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
    ...(row.description_variants_ai === null
      ? {}
      : { descriptionVariantsAi: parseJson(row.description_variants_ai) }),
    sku,
  });
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

export async function updateRecordDetails(
  recordId: string,
  expectedDetailsVersion: number,
  recognize: ProductRecord["recognize"],
  sku: SKUItem[],
): Promise<
  | { kind: "updated"; record: ProductRecord }
  | { kind: "not-found" }
  | { kind: "conflict" }
> {
  const connection = getDatabase();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const current = readRecordById(recordId);
    if (!current) {
      connection.exec("ROLLBACK");
      return { kind: "not-found" };
    }
    if (current.detailsVersion !== expectedDetailsVersion) {
      connection.exec("ROLLBACK");
      return { kind: "conflict" };
    }

    const edits = [...current.edits];
    const aiCorrect = { ...current.aiCorrect };
    for (const field of [
      "category",
      "colors",
      "style",
      "seasons",
      "audience",
      "fabric",
      "tagPrice",
      "item_name",
    ] as const) {
      const from = current.recognize[field];
      const to = recognize[field];
      if (JSON.stringify(from) === JSON.stringify(to)) continue;
      edits.push({ field, from, to, isCorrection: true });
      aiCorrect[field] = false;
    }

    for (const previous of current.sku) {
      const next = sku.find(
        (item) => item.color === previous.color && item.size === previous.size,
      );
      if (!next) continue;
      for (const field of ["stock", "tagPrice", "wholesalePrice"] as const) {
        if (previous[field] === next[field]) continue;
        edits.push({
          field: `sku:${previous.color}/${previous.size}:${field}`,
          from: previous[field],
          to: next[field],
          isCorrection: true,
        });
      }
    }

    const detailsChanged =
      JSON.stringify(current.recognize) !== JSON.stringify(recognize) ||
      JSON.stringify(current.sku) !== JSON.stringify(sku);
    const sourceChanged =
      JSON.stringify(DescriptionSourceSchema.parse(current.recognize)) !==
      JSON.stringify(DescriptionSourceSchema.parse(recognize));
    connection
      .prepare(
        `UPDATE records
         SET recognize = ?, edits = ?, ai_correct = ?,
             description_ai = CASE WHEN ? THEN NULL ELSE description_ai END,
             description_variants_ai = CASE WHEN ? THEN NULL ELSE description_variants_ai END,
             details_version = details_version + ?
         WHERE id = ?`,
      )
      .run(
        JSON.stringify(recognize),
        JSON.stringify(edits),
        JSON.stringify(aiCorrect),
        sourceChanged ? 1 : 0,
        sourceChanged ? 1 : 0,
        detailsChanged ? 1 : 0,
        recordId,
      );
    connection.prepare("DELETE FROM skus WHERE record_id = ?").run(recordId);
    const insertSku = connection.prepare(`
      INSERT INTO skus (record_id, color, size, stock, tag_price, wholesale_price)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const item of sku) {
      insertSku.run(
        recordId,
        item.color,
        item.size,
        item.stock,
        item.tagPrice,
        item.wholesalePrice,
      );
    }
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }

  const updated = await getRecordById(recordId);
  return updated ? { kind: "updated", record: updated } : { kind: "not-found" };
}

export async function saveGeneratedDescription(
  recordId: string,
  expectedSource: DescriptionSource,
  description: string,
  additionalCostEstimate = 0,
): Promise<boolean> {
  return saveGeneratedCopy(
    recordId,
    expectedSource,
    (connection) =>
      connection
        .prepare(
          "UPDATE records SET description_ai = ?, cost_estimate = cost_estimate + ? WHERE id = ?",
        )
        .run(description, additionalCostEstimate, recordId).changes > 0,
  );
}

export async function saveGeneratedDescriptionVariants(
  recordId: string,
  expectedSource: DescriptionSource,
  descriptionVariantsAi: ProductRecord["descriptionVariantsAi"],
  additionalCostEstimate = 0,
): Promise<boolean> {
  if (!descriptionVariantsAi) return false;
  return saveGeneratedCopy(
    recordId,
    expectedSource,
    (connection) =>
      connection
        .prepare(
          "UPDATE records SET description_variants_ai = ?, cost_estimate = cost_estimate + ? WHERE id = ?",
        )
        .run(
          JSON.stringify(descriptionVariantsAi),
          additionalCostEstimate,
          recordId,
        ).changes > 0,
  );
}

async function saveGeneratedCopy(
  recordId: string,
  expectedSource: DescriptionSource,
  write: (connection: Database) => boolean,
): Promise<boolean> {
  const connection = getDatabase();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const current = readRecordById(recordId);
    if (!current) {
      connection.exec("ROLLBACK");
      return false;
    }
    const currentSource = DescriptionSourceSchema.parse(current.recognize);
    if (JSON.stringify(currentSource) !== JSON.stringify(expectedSource)) {
      connection.exec("ROLLBACK");
      return false;
    }
    const saved = write(connection);
    connection.exec(saved ? "COMMIT" : "ROLLBACK");
    return saved;
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
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
      id, details_version, created_at, duration_ms, images, recognize, edits, ai_correct,
      cost_estimate, description, description_ai, description_variants_ai
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      record.id,
      record.detailsVersion,
      record.createdAt,
      JSON.stringify(record.durationMs),
      JSON.stringify(record.images),
      JSON.stringify(record.recognize),
      JSON.stringify(record.edits),
      JSON.stringify(record.aiCorrect),
      record.costEstimate,
      record.description,
      record.descriptionAi ?? null,
      record.descriptionVariantsAi
        ? JSON.stringify(record.descriptionVariantsAi)
        : null,
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
  details_version: number;
  created_at: string;
  duration_ms: string;
  images: string;
  recognize: string;
  edits: string | null;
  ai_correct: string | null;
  cost_estimate: number;
  description: string;
  description_ai: string | null;
  description_variants_ai: string | null;
}

interface SkuRow {
  record_id: string;
  color: string;
  size: string;
  stock: number;
  tag_price: number;
  wholesale_price: number;
}
