import { defineEventHandler } from "h3";
import { readRecords } from "../utils/store";
import { addImageUrls } from "../utils/image-urls";

export default defineEventHandler(async (event) => {
  const { uploadSigningSecret } = useRuntimeConfig(event);
  const records = await readRecords();
  return addImageUrls(records, String(uploadSigningSecret ?? ""));
});
