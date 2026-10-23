import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import {
  defineEventHandler,
  getQuery,
  getRouterParam,
  setResponseHeader,
  type H3Event,
} from "h3";
import { failApi } from "../../utils/api-error";
import { findUploadPath } from "../../utils/store";
import { verifyUploadSignature } from "../../utils/signing";

const fileIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig(event);
  return handleUploadedImage(event, {
    currentSecret: String(runtimeConfig.uploadSigningSecret ?? ""),
    previousSecret: String(runtimeConfig.uploadSigningSecretPrevious ?? ""),
    isProduction: process.env.NODE_ENV === "production",
  });
});

export async function handleUploadedImage(
  event: H3Event,
  config: {
    currentSecret: string;
    previousSecret: string;
    isProduction: boolean;
  },
  nowMs = Date.now(),
): Promise<Buffer> {
  const fileId = getRouterParam(event, "fileId");
  if (!fileId || !fileIdPattern.test(fileId)) {
    failApi(400, "E_VALIDATION", "图片编号无效");
  }

  const query = getQuery(event);
  if (!config.currentSecret) {
    if (config.isProduction) {
      failApi(403, "E_SIGNATURE_INVALID", "图片签名配置无效");
    }
    setResponseHeader(event, "X-Upload-Signature", "disabled");
  } else if (
    !verifyUploadSignature(
      fileId,
      query.exp,
      query.sig,
      config.currentSecret,
      config.previousSecret,
      nowMs,
    )
  ) {
    failApi(403, "E_SIGNATURE_INVALID", "图片链接已过期或无效，请刷新记录列表");
  }

  let imagePath: string | undefined;
  try {
    imagePath = await findUploadPath(fileId);
  } catch {
    failApi(500, "E_READ_FAILED", "图片读取失败");
  }
  if (!imagePath) failApi(404, "E_FILE_NOT_FOUND", "找不到已上传的图片");

  const extension = extname(imagePath).toLowerCase();
  const mime =
    extension === ".jpg"
      ? "image/jpeg"
      : extension === ".png"
        ? "image/png"
        : extension === ".webp"
          ? "image/webp"
          : undefined;
  if (!mime) failApi(404, "E_FILE_NOT_FOUND", "找不到已上传的图片");

  let image: Buffer;
  try {
    image = await readFile(imagePath);
  } catch {
    failApi(500, "E_READ_FAILED", "图片读取失败");
  }

  setResponseHeader(event, "Content-Type", mime);
  setResponseHeader(event, "Content-Length", image.byteLength);
  setResponseHeader(event, "Cache-Control", "private, max-age=60");
  return image;
}
