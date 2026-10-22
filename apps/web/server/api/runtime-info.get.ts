import { defineEventHandler } from "h3";
import { getTrialSpendSummary, priceIsConfigured } from "../utils/budget";
import { isVisionMockEnabled } from "../utils/vision";

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event);
  const summary = getTrialSpendSummary();
  const budget = Number(config.trialBudgetCny);

  return {
    mock: isVisionMockEnabled(config),
    priceConfigured: priceIsConfigured(config),
    spentCny: summary.spentCny,
    reservedCny: summary.reservedCny,
    pendingReconcile: summary.pendingReconcile,
    budget,
    remainingCny: Math.max(0, budget - summary.spentCny - summary.reservedCny),
  };
});
