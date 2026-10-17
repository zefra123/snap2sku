import { RecognizeResultSchema, SKUItemSchema } from "@scope/shared/schema";
import { failApi } from "../../utils/api-error";
import { updateRecordDetails } from "../../utils/store";

export default defineEventHandler(async (event) => {
  const recordId = getRouterParam(event, "id");
  if (!recordId) failApi(400, "E_VALIDATION", "记录编号无效");

  const body: unknown = await readBody(event);
  if (
    typeof body !== "object" ||
    body === null ||
    !("recognize" in body) ||
    !("sku" in body)
  ) {
    failApi(400, "E_VALIDATION", "提交内容不完整或格式错误");
  }
  const recognize = RecognizeResultSchema.safeParse(body.recognize);
  const sku = SKUItemSchema.array().min(1).safeParse(body.sku);
  if (!recognize.success || !sku.success) {
    failApi(400, "E_VALIDATION", "商品资料或 SKU 格式错误");
  }

  let updated;
  try {
    updated = await updateRecordDetails(recordId, recognize.data, sku.data);
  } catch {
    failApi(500, "E_WRITE_FAILED", "记录修改失败，请保留修改内容后重试");
  }
  if (!updated) failApi(404, "E_RECORD_NOT_FOUND", "找不到这条商品记录");
  return updated;
});
