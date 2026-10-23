import {
  defineEventHandler,
  getHeader,
  getRequestURL,
  setResponseHeader,
} from "h3";
import {
  assertAccessCode,
  throwAccessCodeRequired,
} from "../utils/access-code";

// 规则保护：/api/** 下所有非只读请求一律校验访问码。
// 不用路由白名单——新增可写接口时容易漏登记（P2-1 评审结论）。
const readOnlyMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const PROTECTED_READ_PREFIXES = ["/api/records", "/api/runtime-info"];

export default defineEventHandler((event) => {
  const policy = checkAccessCodeRequest(
    event.method,
    getRequestURL(event).pathname,
    String(useRuntimeConfig(event).accessCode ?? ""),
    getHeader(event, "x-access-code") ?? "",
    process.env.NODE_ENV === "production",
  );

  if (policy === "disabled") {
    setResponseHeader(event, "X-Access-Code-Mode", "disabled");
  }
});

export function checkAccessCodeRequest(
  method: string,
  pathname: string,
  configuredCode: string,
  suppliedCode: string,
  isProduction: boolean,
): "bypassed" | "disabled" | "validated" {
  // /api/uploads/* 靠 HMAC 签名 URL 保护（<img src> 无法携带自定义请求头）；
  // /api/health 是 Nginx / 容器探针入口，且已去除内部状态字段。
  const isProtectedRead =
    method === "GET" &&
    PROTECTED_READ_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
  const isProtectedWrite = !readOnlyMethods.has(method) && isApiPath(pathname);
  if (!isProtectedRead && !isProtectedWrite) return "bypassed";
  if (!configuredCode.trim()) {
    if (isProduction) throwAccessCodeRequired();
    return "disabled";
  }
  assertAccessCode(configuredCode, suppliedCode);
  return "validated";
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}
