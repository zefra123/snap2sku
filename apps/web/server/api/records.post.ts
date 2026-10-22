import { ProductRecordSchema, MAX_RECORD_IMAGES } from "@scope/shared/schema";
import { defineEventHandler, setResponseStatus, type H3Event } from "h3";
import { failApi } from "../utils/api-error";
import { appendRecord, findUploadPath } from "../utils/store";

export default defineEventHandler(async (event) =>
  handleCreateRecord(event, await readBody(event)),
);

export async function handleCreateRecord(
  event: H3Event,
  input: unknown,
): Promise<ReturnType<typeof ProductRecordSchema.parse>> {
  const parsed = ProductRecordSchema.safeParse(input);
  if (!parsed.success) failApi(400, "E_VALIDATION", "提交内容不完整或格式错误");
  if (parsed.data.images.length > MAX_RECORD_IMAGES) {
    failApi(
      400,
      "E_VALIDATION",
      `每条记录最多保存 ${MAX_RECORD_IMAGES} 张图片`,
    );
  }

  for (const fileId of parsed.data.images) {
    let imagePath: string | undefined;
    try {
      imagePath = await findUploadPath(fileId);
    } catch {
      failApi(500, "E_READ_FAILED", "图片读取失败");
    }
    if (!imagePath) {
      failApi(400, "E_IMAGE_MISSING", "有图片已失效，请重新上传后再提交");
    }
  }

  const record = { ...parsed.data, detailsVersion: 0 };

  try {
    await appendRecord(record);
  } catch (error) {
    console.error("[records] 保存记录失败", error);
    failApi(500, "E_WRITE_FAILED", "记录保存失败，请保留表单内容后重试");
  }

  setResponseStatus(event, 201);
  return record;
}
