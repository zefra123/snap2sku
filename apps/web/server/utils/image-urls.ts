import {
  ProductRecordWithImageUrlsSchema,
  type ProductRecord,
} from "@scope/shared/schema";
import { signUploadUrl, UPLOAD_URL_TTL_SECONDS } from "./signing";

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
