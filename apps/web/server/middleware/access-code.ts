import { timingSafeEqual } from "node:crypto";
import type { H3Event } from "h3";
import { failApi } from "../utils/api-error";

// 规则保护：/api/** 下所有非只读请求一律校验访问码。
// 不用路由白名单——新增可写接口时容易漏登记（P2-1 评审结论）。
const readOnlyMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export default defineEventHandler((event) => {
  if (!isProtectedWrite(event)) return;

  const configuredCode = String(useRuntimeConfig(event).accessCode ?? "");
  if (!configuredCode) {
    setResponseHeader(event, "X-Access-Code-Mode", "disabled");
    return;
  }

  const suppliedCode = getHeader(event, "x-access-code") ?? "";
  if (!matchesAccessCode(configuredCode, suppliedCode)) {
    failApi(401, "E_ACCESS_CODE_REQUIRED", "访问码缺失或不正确");
  }
});

function isProtectedWrite(event: H3Event): boolean {
  if (readOnlyMethods.has(event.method)) return false;
  const pathname = getRequestURL(event).pathname;
  return pathname === "/api" || pathname.startsWith("/api/");
}

function matchesAccessCode(expected: string, supplied: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}
