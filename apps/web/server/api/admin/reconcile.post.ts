import { readBody } from "h3";
import { failApi } from "../../utils/api-error";
import { reconcileUnknownModelSpend } from "../../utils/budget";

export default defineEventHandler(async (event) => {
  const body = await readBody<unknown>(event);
  if (
    typeof body !== "object" ||
    body === null ||
    !("id" in body) ||
    typeof body.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      body.id,
    ) ||
    !("decision" in body) ||
    (body.decision !== "settled" && body.decision !== "released")
  ) {
    failApi(400, "E_VALIDATION", "对账参数无效");
  }

  if (!reconcileUnknownModelSpend(body.id, body.decision)) {
    failApi(400, "E_VALIDATION", "待对账记录不存在或已处理");
  }
  return { id: body.id, status: body.decision };
});
