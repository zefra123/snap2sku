import type { H3Event } from "h3";
import { assertAccessCode } from "../utils/access-code";

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
  assertAccessCode(configuredCode, suppliedCode);
});

function isProtectedWrite(event: H3Event): boolean {
  if (readOnlyMethods.has(event.method)) return false;
  const pathname = getRequestURL(event).pathname;
  return pathname === "/api" || pathname.startsWith("/api/");
}
