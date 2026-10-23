import { describe, expect, it } from "vitest";
import { checkAccessCodeRequest } from "./access-code";
import {
  assertProductionAccessCodeConfigured,
  assertProductionDataDirectoryConfigured,
  assertProductionDataDirectoryExists,
  assertProductionUploadSigningSecretConfigured,
} from "../utils/access-code";

describe("access code request policy", () => {
  it("production startup rejects an empty code while development allows it", () => {
    expect(() => assertProductionAccessCodeConfigured(true, " ")).toThrow(
      "必须设置 NUXT_ACCESS_CODE，否则拒绝启动",
    );
    expect(() => assertProductionAccessCodeConfigured(false, "")).not.toThrow();
    expect(() =>
      assertProductionAccessCodeConfigured(true, "configured"),
    ).not.toThrow();
  });

  it("requires a canonical 32-byte signing key in production", () => {
    const key = Buffer.alloc(32, 7).toString("base64url");
    expect(() =>
      assertProductionUploadSigningSecretConfigured(true, ""),
    ).toThrow(
      "必须设置至少 32 字节随机值的 NUXT_UPLOAD_SIGNING_SECRET，否则拒绝启动",
    );
    expect(() =>
      assertProductionUploadSigningSecretConfigured(true, "too-short"),
    ).toThrow("NUXT_UPLOAD_SIGNING_SECRET");
    expect(() =>
      assertProductionUploadSigningSecretConfigured(true, key),
    ).not.toThrow();
    expect(() =>
      assertProductionUploadSigningSecretConfigured(false, ""),
    ).not.toThrow();
  });

  it("requires an explicit data directory in production", () => {
    expect(() => assertProductionDataDirectoryConfigured(true, " ")).toThrow(
      "必须设置 NUXT_DATA_DIR，否则拒绝启动",
    );
    expect(() =>
      assertProductionDataDirectoryConfigured(false, ""),
    ).not.toThrow();
    expect(() =>
      assertProductionDataDirectoryConfigured(true, "C:/snap2sku/data"),
    ).not.toThrow();
  });

  it("refuses to start in production when the data directory is missing", () => {
    // 目录写错时自动创建 → 静默启用空账本 → 熔断失效且零报警，必须拒绝启动
    expect(() =>
      assertProductionDataDirectoryExists(true, "/opt/snap2sku/dat", false),
    ).toThrow("拒绝启动");
    expect(() =>
      assertProductionDataDirectoryExists(true, "/opt/snap2sku/dat", false),
    ).toThrow("不会自动创建数据目录");
    // 目录存在则放行
    expect(() =>
      assertProductionDataDirectoryExists(true, "/opt/snap2sku/data", true),
    ).not.toThrow();
    // 本地开发仍然允许自动创建
    expect(() =>
      assertProductionDataDirectoryExists(false, "C:/tmp/snap2sku", false),
    ).not.toThrow();
  });

  it("production with an empty code rejects protected writes", () => {
    try {
      checkAccessCodeRequest("POST", "/api/upload", "", "", true);
      throw new Error("expected access code rejection");
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 401,
        data: { code: "E_ACCESS_CODE_REQUIRED" },
      });
    }
  });

  it("production rejects a wrong code and accepts the configured code", () => {
    expect(() =>
      checkAccessCodeRequest("POST", "/api/upload", "secret", "wrong", true),
    ).toThrow("E_ACCESS_CODE_REQUIRED");
    expect(
      checkAccessCodeRequest("POST", "/api/upload", "secret", "secret", true),
    ).toBe("validated");
  });

  it("development with no code disables the gate", () => {
    expect(checkAccessCodeRequest("POST", "/api/upload", "", "", false)).toBe(
      "disabled",
    );
  });

  it.each(["HEAD", "OPTIONS"])(
    "%s requests bypass the write and read gate",
    (method) => {
      expect(checkAccessCodeRequest(method, "/api/records", "", "", true)).toBe(
        "bypassed",
      );
    },
  );

  it("GET /api/records requires a code while other API reads remain public", () => {
    expect(() =>
      checkAccessCodeRequest("GET", "/api/records", "", "", true),
    ).toThrow("E_ACCESS_CODE_REQUIRED");
    expect(
      checkAccessCodeRequest("GET", "/api/records", "secret", "secret", true),
    ).toBe("validated");
    expect(() =>
      checkAccessCodeRequest("GET", "/api/records/", "", "", true),
    ).toThrow("E_ACCESS_CODE_REQUIRED");
    expect(() =>
      checkAccessCodeRequest("GET", "/api/records/abc", "", "", true),
    ).toThrow("E_ACCESS_CODE_REQUIRED");
    expect(checkAccessCodeRequest("GET", "/api/health", "", "", true)).toBe(
      "bypassed",
    );
    expect(
      checkAccessCodeRequest("GET", "/api/uploads/file", "", "", true),
    ).toBe("bypassed");
  });

  it("protects runtime-info reads while keeping health and uploads public", () => {
    expect(() =>
      checkAccessCodeRequest("GET", "/api/runtime-info", "", "", true),
    ).toThrow("E_ACCESS_CODE_REQUIRED");
    expect(() =>
      checkAccessCodeRequest(
        "GET",
        "/api/runtime-info",
        "secret",
        "nope",
        true,
      ),
    ).toThrow("E_ACCESS_CODE_REQUIRED");
    expect(
      checkAccessCodeRequest(
        "GET",
        "/api/runtime-info",
        "secret",
        "secret",
        true,
      ),
    ).toBe("validated");
    expect(checkAccessCodeRequest("GET", "/api/health", "", "", true)).toBe(
      "bypassed",
    );
    expect(
      checkAccessCodeRequest("GET", "/api/uploads/file", "", "", true),
    ).toBe("bypassed");
  });

  it("non-API writes bypass the gate", () => {
    expect(checkAccessCodeRequest("POST", "/health", "", "", true)).toBe(
      "bypassed",
    );
  });
});
