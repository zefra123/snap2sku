import type { H3Event } from "h3";
import { failApi } from "./api-error";
import {
  markModelSpendUnknown,
  modelSpendSummary,
  recentSettledSpendCny,
  reconcileModelSpend,
  releaseModelSpend,
  extendModelSpend,
  reserveModelSpend,
  settleModelSpend,
  type ModelSpendKind,
} from "./store";
import type { ModelUsage } from "@scope/shared/schema";

export interface ModelSpendReservation {
  id: string;
  reservedCny: number;
  capCny: number;
  priceConfigured: boolean;
}

export function priceIsConfigured(config: {
  visionInputPricePerMillion?: unknown;
  visionOutputPricePerMillion?: unknown;
}): boolean {
  const input = Number(config.visionInputPricePerMillion);
  const output = Number(config.visionOutputPricePerMillion);
  return (
    Number.isFinite(input) && input > 0 && Number.isFinite(output) && output > 0
  );
}

export function estimateReserveCny(
  recentCosts: number[],
  configuredReserve: unknown,
): number {
  const hasConfiguredReserve =
    configuredReserve !== undefined &&
    configuredReserve !== null &&
    String(configuredReserve).trim() !== "";
  const configured = hasConfiguredReserve ? Number(configuredReserve) : 0;
  if (
    hasConfiguredReserve &&
    (!Number.isFinite(configured) || configured <= 0)
  ) {
    throw new Error("NUXT_TRIAL_RESERVE_CNY 必须是有限正数");
  }

  const usableCosts = recentCosts.filter(
    (cost) => Number.isFinite(cost) && cost >= 0,
  );
  const historical =
    usableCosts.length < 20 || usableCosts.every((cost) => cost === 0)
      ? 0.05
      : (usableCosts.reduce((total, cost) => total + cost, 0) /
          usableCosts.length) *
        2;
  return Number(Math.max(configured, historical).toFixed(8));
}

export function validateTrialBudgetConfiguration(config: {
  trialBudgetCny?: unknown;
  trialReserveCny?: unknown;
}): void {
  const cap = Number(config.trialBudgetCny);
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new Error("NUXT_TRIAL_BUDGET_CNY 必须是有限正数");
  }
  estimateReserveCny([], config.trialReserveCny);
}

export function reserveModelCall(
  event: H3Event,
  kind: ModelSpendKind,
  recordId?: string,
): ModelSpendReservation {
  const config = useRuntimeConfig(event);
  const capCny = Number(config.trialBudgetCny);
  const reserveCny = estimateReserveCny(
    recentSettledSpendCny(kind),
    config.trialReserveCny,
  );
  const reservation = reserveModelSpend({
    kind,
    recordId,
    trialId: String(config.trialId ?? "") || undefined,
    capCny,
    reserveCny,
  });
  if (!reservation) {
    failApi(402, "E_BUDGET_EXHAUSTED", "试用额度已用完，请稍后再试");
  }
  return {
    id: reservation.id,
    reservedCny: reservation.reservedCny,
    capCny,
    priceConfigured: priceIsConfigured(config),
  };
}

export function settleModelCall(
  reservation: ModelSpendReservation,
  usage: ModelUsage,
  estimatedCostCny: number,
  requestCount = 1,
): number {
  const usageAvailable = usage.total_tokens > 0;
  const floorCny = reservation.reservedCny * Math.max(1, requestCount);
  const costCny = Math.max(estimatedCostCny, floorCny);
  const estimated =
    !reservation.priceConfigured ||
    !usageAvailable ||
    estimatedCostCny < floorCny;
  if (estimated) {
    console.warn(
      `[trial-budget] 第 ${reservation.id} 笔按估算记账：请求 ${requestCount} 次，记 ¥${costCny}`,
    );
  }
  if (costCny > reservation.reservedCny) {
    console.warn(
      `[trial-budget] 结算金额 ${costCny} 高于预占 ${reservation.reservedCny}，实际费用可能超过软熔断目标`,
    );
  }
  settleModelSpend(reservation.id, {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    costCny,
    estimated,
    note: estimated ? "费用按预占估算，单价或 usage 不完整" : undefined,
  });
  return costCny;
}

export async function runReservedModelCall<
  T extends { usage: ModelUsage; costEstimate: number },
>(
  reservation: ModelSpendReservation,
  request: (markRequestStarted: () => void) => Promise<T>,
): Promise<T> {
  let requestCount = 0;
  try {
    const generated = await request(() => {
      requestCount += 1;
      if (
        requestCount > 1 &&
        !extendModelSpend(
          reservation.id,
          reservation.reservedCny,
          reservation.capCny,
        )
      ) {
        failApi(402, "E_BUDGET_EXHAUSTED", "试用额度已用完，无法重试模型请求");
      }
    });
    if (requestCount > 1) {
      console.warn(
        `[trial-budget] 模型调用 ${reservation.id} 发出 ${requestCount} 次 HTTP 请求，已逐次追加预占`,
      );
    }
    const settledCost = settleModelCall(
      reservation,
      generated.usage,
      generated.costEstimate,
      requestCount,
    );
    return { ...generated, costEstimate: settledCost };
  } catch (error) {
    try {
      if (requestCount > 0) {
        markModelCallUnknown(reservation.id);
      } else {
        releaseModelCallBeforeRequest(
          reservation.id,
          "预检失败，确认尚未调用模型服务",
        );
      }
    } catch (ledgerError) {
      console.error("[trial-budget] 更新账本状态失败", ledgerError);
    }
    throw error;
  }
}

export function releaseModelCallBeforeRequest(
  reservationId: string,
  reason: string,
): void {
  // 只能在确认尚未调用 fetch 时使用；fetch 抛错一律进入 unknown。
  releaseModelSpend(reservationId, reason);
}

export function markModelCallUnknown(
  reservationId: string,
  reason = "模型请求已发出，但无法确认服务端计费结果",
): void {
  markModelSpendUnknown(reservationId, reason);
}

export function getTrialSpendSummary() {
  return modelSpendSummary();
}

export function reconcileUnknownModelSpend(
  id: string,
  decision: "settled" | "released",
): boolean {
  return reconcileModelSpend(id, decision);
}
