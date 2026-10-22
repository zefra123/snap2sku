import {
  getTrialSpendSummary,
  priceIsConfigured,
  validateTrialBudgetConfiguration,
} from "../utils/budget";
import { isVisionMockEnabled } from "../utils/vision";

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig();
  validateTrialBudgetConfiguration(config);
  const isProduction = process.env.NODE_ENV === "production";
  if (
    isProduction &&
    !isVisionMockEnabled(config) &&
    !priceIsConfigured(config)
  ) {
    console.warn(
      "[trial-budget] 未配置视觉模型输入和输出单价；费用统计不可信，试用预算仅为软熔断目标。",
    );
  }

  const summary = getTrialSpendSummary();
  if (summary.pendingReconcile > 0) {
    console.warn(
      `[trial-budget] 有 ${summary.pendingReconcile} 条模型调用待人工对账；预占金额继续占用额度。`,
    );
  }
});
