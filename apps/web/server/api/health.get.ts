import { defineEventHandler } from "h3";
import { getTrialSpendSummary } from "../utils/budget";

export default defineEventHandler(() => ({
  status: "ok",
  pendingReconcile: getTrialSpendSummary().pendingReconcile,
}));
