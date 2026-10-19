import { ProductRecordWithImageUrlsSchema } from "@scope/shared/schema";
import { defineEventHandler } from "h3";
import type { ProductRecord } from "@scope/shared/schema";
import { readRecords } from "../utils/store";
import { signUploadUrl, UPLOAD_URL_TTL_SECONDS } from "../utils/signing";

export default defineEventHandler(async (event) => {
  const { uploadSigningSecret } = useRuntimeConfig(event);
  const records = await readRecords();
  return addImageUrls(records, String(uploadSigningSecret ?? ""));
});

export function addImageUrls(
  records: ProductRecord[],
  secret: string,
  nowMs = Date.now(),
) {
  return records.map((record) =>
    ProductRecordWithImageUrlsSchema.parse({
      ...record,
      imageUrls: record.images.map((fileId) =>
        signUploadUrl(fileId, UPLOAD_URL_TTL_SECONDS, secret, nowMs),
      ),
    }),
  );
}
