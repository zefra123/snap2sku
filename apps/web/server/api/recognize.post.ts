import {
  RecognizeRequestSchema,
  RecognizeResponseSchema,
} from "@scope/shared/schema";
import { failApi } from "../utils/api-error";
import { recognizeImage, type MockFixture } from "../utils/vision";

export default defineEventHandler(async (event) => {
  const parsed = RecognizeRequestSchema.safeParse(await readBody(event));
  if (!parsed.success) {
    failApi(400, "E_VALIDATION", "图片编号无效");
  }
  const fileIds =
    "fileIds" in parsed.data ? parsed.data.fileIds : [parsed.data.fileId];
  const fixture: MockFixture =
    parsed.data.mockFixture === "noTagPrice"
      ? "noTagPrice"
      : parsed.data.mockFixture === "allNull"
        ? "allNull"
        : "tagPrice";
  const response = await recognizeImage(fileIds, fixture, event);
  return RecognizeResponseSchema.parse(response);
});
