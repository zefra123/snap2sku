import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createError } from "h3";
import {
  estimateReserveCny,
  priceIsConfigured,
  runReservedModelCall,
} from "./budget";
import {
  closeStore,
  initializeStore,
  markModelSpendUnknown,
  modelSpendSummary,
  reconcileModelSpend,
  releaseModelSpend,
  reserveModelSpend,
  settleModelSpend,
  uploadPath,
} from "./store";
import {
  describeProduct,
  describeProductVariants,
  getMockRecognizeResult,
  recognizeImage,
} from "./vision";
import type { H3Event } from "h3";

let directory: string | undefined;
afterEach(() => {
  vi.unstubAllGlobals();
  closeStore();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("trial model spend ledger", () => {
  it("does not reserve or settle model spend for mock recognition and variants", async () => {
    const dataDirectory = createDirectory();
    initializeStore(dataDirectory);
    const fileId = "b8d18f28-5964-4c9e-a2f8-0ae388a32d74";
    mkdirSync(join(dataDirectory, "uploads"), { recursive: true });
    writeFileSync(uploadPath(`${fileId}.jpg`), "fixture");
    vi.stubGlobal("useRuntimeConfig", () => ({ visionMock: "1" }));
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);

    const event = { context: { params: { id: fileId } } } as unknown as H3Event;
    await recognizeImage(fileId, "tagPrice", event);
    await describeProductVariants(
      {
        category: "上衣",
        colors: [{ name: "黑色", hex: "#000000" }],
        style: "休闲",
        seasons: ["夏"],
        audience: "女",
        fabric: null,
        tagPrice: null,
        item_name: "黑色休闲短袖上衣",
      },
      event,
    );

    expect(fetchStub).not.toHaveBeenCalled();
    expect(modelSpendSummary()).toEqual({
      spentCny: 0,
      reservedCny: 0,
      pendingReconcile: 0,
    });
  });

  it("settles one real call and blocks the next before another model request", async () => {
    const dataDirectory = createDirectory();
    initializeStore(dataDirectory);
    const fileId = "b8d18f28-5964-4c9e-a2f8-0ae388a32d74";
    mkdirSync(join(dataDirectory, "uploads"), { recursive: true });
    writeFileSync(uploadPath(`${fileId}.jpg`), "fixture");
    vi.stubGlobal("useRuntimeConfig", () => ({
      visionMock: "0",
      visionApiKey: "test-key",
      visionModel: "glm-4v-flash",
      visionBaseUrl: "http://127.0.0.1:4000/v4/chat/completions",
      visionInputPricePerMillion: 2,
      visionOutputPricePerMillion: 8,
      trialBudgetCny: 0.05,
      trialReserveCny: 0.05,
      trialId: "budget-test",
    }));
    vi.stubGlobal("createError", createError);
    const result = getMockRecognizeResult("tagPrice");
    const fetchStub = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(result) } }],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150,
            },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchStub);
    const event = { context: { params: {} } } as unknown as H3Event;

    await recognizeImage(fileId, "tagPrice", event);
    await expect(
      recognizeImage(fileId, "tagPrice", event),
    ).rejects.toMatchObject({
      statusCode: 402,
      data: { code: "E_BUDGET_EXHAUSTED" },
    });

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(modelSpendSummary().reservedCny).toBe(0);
    expect(modelSpendSummary().spentCny).toBeGreaterThan(0);
  });

  it("sums three settled calls independently of records", () => {
    initializeStore(createDirectory());
    for (const costCny of [0.01, 0.02, 0.03]) {
      const reservation = reserve({ capCny: 1, reserveCny: 0.05 });
      settleModelSpend(reservation.id, {
        promptTokens: 100,
        completionTokens: 20,
        costCny,
        estimated: false,
      });
    }
    expect(modelSpendSummary()).toEqual({
      spentCny: 0.06,
      reservedCny: 0,
      pendingReconcile: 0,
    });
  });

  it("atomically allows exactly the reservations that fit the cap", async () => {
    initializeStore(createDirectory());
    const reservations = await Promise.all(
      Array.from({ length: 5 }, async () =>
        tryReserve({ capCny: 0.15, reserveCny: 0.05 }),
      ),
    );
    const accepted = reservations.filter(
      (reservation) => reservation !== undefined,
    );
    expect(accepted).toHaveLength(3);
    for (const reservation of accepted) {
      settleModelSpend(reservation.id, {
        promptTokens: 100,
        completionTokens: 20,
        costCny: 0.04,
        estimated: false,
      });
    }
    expect(modelSpendSummary()).toMatchObject({
      spentCny: 0.12,
      reservedCny: 0,
    });
    expect(tryReserve({ capCny: 0.15, reserveCny: 0.05 })).toBeUndefined();
  });

  it("keeps unknown reservations charged after store restart", () => {
    const dataDirectory = createDirectory();
    initializeStore(dataDirectory);
    const reservation = reserve({ capCny: 0.1, reserveCny: 0.05 });
    markModelSpendUnknown(reservation.id, "网络请求超时");
    closeStore();
    initializeStore(dataDirectory);

    expect(modelSpendSummary()).toEqual({
      spentCny: 0,
      reservedCny: 0.05,
      pendingReconcile: 1,
    });
    expect(tryReserve({ capCny: 0.09, reserveCny: 0.05 })).toBeUndefined();
    expect(reconcileModelSpend(reservation.id, "settled")).toBe(true);
    expect(modelSpendSummary()).toEqual({
      spentCny: 0.05,
      reservedCny: 0,
      pendingReconcile: 0,
    });
  });

  it("moves an interrupted reservation to unknown after a simulated restart", () => {
    const dataDirectory = createDirectory();
    initializeStore(dataDirectory);
    reserve({ capCny: 0.1, reserveCny: 0.05 });
    closeStore();

    initializeStore(dataDirectory);
    expect(modelSpendSummary()).toEqual({
      spentCny: 0,
      reservedCny: 0.05,
      pendingReconcile: 1,
    });
  });

  it("releases a preflight reservation and allows confirmed reconciliation release", () => {
    initializeStore(createDirectory());
    const preflightReservation = reserve({ capCny: 0.1, reserveCny: 0.05 });
    releaseModelSpend(preflightReservation.id, "请求发送前参数校验失败");
    expect(modelSpendSummary().reservedCny).toBe(0);

    const unknownReservation = reserve({ capCny: 0.1, reserveCny: 0.05 });
    markModelSpendUnknown(unknownReservation.id, "请求状态不明");
    expect(reconcileModelSpend(unknownReservation.id, "released")).toBe(true);
    expect(modelSpendSummary()).toEqual({
      spentCny: 0,
      reservedCny: 0,
      pendingReconcile: 0,
    });
  });

  it("does not refund an unknown model request when the call throws", async () => {
    initializeStore(createDirectory());
    const reservation = reserve({ capCny: 0.1, reserveCny: 0.05 });
    await expect(
      runReservedModelCall(reservation, async (markRequestStarted) => {
        markRequestStarted();
        throw new Error("timeout");
      }),
    ).rejects.toThrow("timeout");
    expect(modelSpendSummary()).toEqual({
      spentCny: 0,
      reservedCny: 0.05,
      pendingReconcile: 1,
    });
  });

  it("uses the configured floor or a conservative history fallback", () => {
    expect(estimateReserveCny([], "")).toBe(0.05);
    expect(estimateReserveCny(Array(20).fill(0), "")).toBe(0.05);
    expect(estimateReserveCny(Array(20).fill(0.01), "")).toBe(0.02);
    expect(estimateReserveCny(Array(20).fill(0.01), "0.03")).toBe(0.03);
    expect(() => estimateReserveCny([], "0")).toThrow(
      "NUXT_TRIAL_RESERVE_CNY 必须是有限正数",
    );
  });

  it("reports pricing as configured only when both rates are positive", () => {
    expect(
      priceIsConfigured({
        visionInputPricePerMillion: 2,
        visionOutputPricePerMillion: 8,
      }),
    ).toBe(true);
    expect(
      priceIsConfigured({
        visionInputPricePerMillion: 0,
        visionOutputPricePerMillion: 8,
      }),
    ).toBe(false);
  });

  it.each(["recognize", "describe", "describeVariants"] as const)(
    "rejects %s before a model request when the reservation cannot fit",
    async (kind) => {
      const dataDirectory = createDirectory();
      initializeStore(dataDirectory);
      const event = { context: { params: {} } } as H3Event;
      vi.stubGlobal("createError", createError);
      vi.stubGlobal("useRuntimeConfig", () => ({
        visionMock: "0",
        visionApiKey: "test-key",
        visionModel: "glm-4v-flash",
        visionBaseUrl: "http://127.0.0.1:4000/v4/chat/completions",
        visionInputPricePerMillion: 2,
        visionOutputPricePerMillion: 8,
        trialBudgetCny: 0.01,
        trialReserveCny: 0.05,
        trialId: "budget-test",
      }));
      const fetchStub = vi.fn(async () => new Response("{}"));
      vi.stubGlobal("fetch", fetchStub);

      if (kind === "recognize") {
        const fileId = "b8d18f28-5964-4c9e-a2f8-0ae388a32d74";
        mkdirSync(join(dataDirectory, "uploads"), { recursive: true });
        writeFileSync(uploadPath(`${fileId}.jpg`), "fixture");
        await expect(
          recognizeImage(fileId, "tagPrice", event),
        ).rejects.toMatchObject({
          statusCode: 402,
          data: { code: "E_BUDGET_EXHAUSTED" },
        });
      } else if (kind === "describe") {
        await expect(
          describeProduct(
            {
              category: "上衣",
              colors: [{ name: "黑色", hex: "#000000" }],
              style: "休闲",
              seasons: ["夏"],
              audience: "女",
              fabric: null,
              tagPrice: null,
              item_name: "黑色休闲短袖上衣",
            },
            event,
          ),
        ).rejects.toMatchObject({
          statusCode: 402,
          data: { code: "E_BUDGET_EXHAUSTED" },
        });
      } else {
        await expect(
          describeProductVariants(
            {
              category: "上衣",
              colors: [{ name: "黑色", hex: "#000000" }],
              style: "休闲",
              seasons: ["夏"],
              audience: "女",
              fabric: null,
              tagPrice: null,
              item_name: "黑色休闲短袖上衣",
            },
            {
              context: {
                params: { id: "b8d18f28-5964-4c9e-a2f8-0ae388a32d74" },
              },
            } as unknown as H3Event,
          ),
        ).rejects.toMatchObject({
          statusCode: 402,
          data: { code: "E_BUDGET_EXHAUSTED" },
        });
      }
      expect(fetchStub).not.toHaveBeenCalled();
    },
  );
});

function createDirectory(): string {
  directory = mkdtempSync(join(tmpdir(), "snap2sku-budget-"));
  return directory;
}

function reserve(input: { capCny: number; reserveCny: number }) {
  const reservation = tryReserve(input);
  if (!reservation) throw new Error("预期有可用额度");
  return { ...reservation, priceConfigured: true };
}

function tryReserve(input: { capCny: number; reserveCny: number }) {
  return reserveModelSpend({
    kind: "recognize",
    trialId: "budget-test",
    ...input,
  });
}
