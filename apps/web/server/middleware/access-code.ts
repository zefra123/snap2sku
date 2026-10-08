import { timingSafeEqual } from "node:crypto";
import type { H3Event } from "h3";
import { failApi } from "../utils/api-error";

const protectedWriteRoutes = new Set([
  "/api/upload",
  "/api/recognize",
  "/api/describe",
  "/api/records",
]);

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
  if (event.method !== "POST") return false;
  const pathname = getRequestURL(event).pathname.replace(/\/$/, "");
  return protectedWriteRoutes.has(pathname);
}

function matchesAccessCode(expected: string, supplied: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}
