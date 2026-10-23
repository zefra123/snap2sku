import { RecognizeResultSchema, SKUItemSchema } from "@scope/shared/schema";
import { z } from "zod";
import { failApi } from "../../utils/api-error";
import { addImageUrls } from "../../utils/image-urls";
import { updateRecordDetails } from "../../utils/store";

export default defineEventHandler(async (event) => {
  const recordId = getRouterParam(event, "id");
  if (!recordId) failApi(400, "E_VALIDATION", "记录编号无效");

  const body: unknown = await readBody(event);
  if (
    typeof body !== "object" ||
    body === null ||
    !("detailsVersion" in body) ||
    !("recognize" in body) ||
    !("sku" in body)
  ) {
    failApi(400, "E_VALIDATION", "提交内容不完整或格式错误");
  }
  const detailsVersion = z
    .number()
    .int()
    .nonnegative()
    .safeParse(body.detailsVersion);
  const recognize = RecognizeResultSchema.safeParse(body.recognize);
  const sku = SKUItemSchema.array().min(1).safeParse(body.sku);
  if (!detailsVersion.success || !recognize.success || !sku.success) {
    failApi(400, "E_VALIDATION", "商品资料或 SKU 格式错误");
  }

  let updated;
  try {
    updated = await updateRecordDetails(
      recordId,
      detailsVersion.data,
      recognize.data,
      sku.data,
    );
  } catch {
    failApi(500, "E_WRITE_FAILED", "记录修改失败，请保留修改内容后重试");
  }
  if (updated.kind === "conflict") {
    failApi(409, "E_RECORD_CONFLICT", "记录已被其他页面修改，请刷新后再编辑");
  }
  if (updated.kind === "not-found") {
    failApi(404, "E_RECORD_NOT_FOUND", "找不到这条商品记录");
  }
  const { uploadSigningSecret } = useRuntimeConfig(event);
  return addImageUrls([updated.record], String(uploadSigningSecret ?? ""))[0];
});
