import { timingSafeEqual } from "node:crypto";
import { createError } from "h3";

export function assertAccessCode(expected: string, supplied: string): void {
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  )
    return;

  throwAccessCodeRequired();
}

export function throwAccessCodeRequired(): never {
  throw createError({
    statusCode: 401,
    statusMessage: "E_ACCESS_CODE_REQUIRED: 访问码缺失或不正确",
    data: { code: "E_ACCESS_CODE_REQUIRED", message: "访问码缺失或不正确" },
  });
}

export function assertProductionAccessCodeConfigured(
  isProduction: boolean,
  configuredCode: string,
): void {
  if (isProduction && !configuredCode.trim()) {
    throw new Error("必须设置 NUXT_ACCESS_CODE，否则拒绝启动");
  }
}
