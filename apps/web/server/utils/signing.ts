import { createHmac, timingSafeEqual } from "node:crypto";

export const UPLOAD_URL_TTL_SECONDS = 60;

export function signUploadUrl(
  fileId: string,
  ttlSec: number,
  secret: string,
  nowMs = Date.now(),
): string {
  if (!secret) {
    console.warn(
      "[signing] NUXT_UPLOAD_SIGNING_SECRET 未配置，签名 URL 降级为无签名路径（仅允许开发环境）",
    );
    return `/api/uploads/${encodeURIComponent(fileId)}`;
  }
  if (
    !Number.isSafeInteger(ttlSec) ||
    ttlSec < 1 ||
    ttlSec > UPLOAD_URL_TTL_SECONDS
  ) {
    throw new RangeError("图片签名链接有效期必须在 1–60 秒内");
  }

  const exp = Math.floor(nowMs / 1000) + ttlSec;
  const signature = createSignature(fileId, exp, secret);
  return `/api/uploads/${encodeURIComponent(fileId)}?exp=${exp}&sig=${signature}`;
}

export function verifyUploadSignature(
  fileId: string,
  expValue: unknown,
  signatureValue: unknown,
  currentSecret: string,
  previousSecret = "",
  nowMs = Date.now(),
): boolean {
  const exp = parseExpiration(expValue);
  if (
    exp === undefined ||
    typeof signatureValue !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(signatureValue)
  ) {
    return false;
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  if (exp <= nowSeconds || exp - nowSeconds > UPLOAD_URL_TTL_SECONDS) {
    return false;
  }

  return [currentSecret, previousSecret].some((secret) =>
    secret
      ? signaturesEqual(createSignature(fileId, exp, secret), signatureValue)
      : false,
  );
}

function parseExpiration(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d{1,12}$/.test(value)) return undefined;
  const exp = Number(value);
  return Number.isSafeInteger(exp) ? exp : undefined;
}

function createSignature(fileId: string, exp: number, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${fileId}.${exp}`)
    .digest("base64url");
}

function signaturesEqual(expected: string, supplied: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}
