import { describe, expect, it } from "vitest";
import { checkAccessCodeRequest } from "./access-code";
import { assertProductionAccessCodeConfigured } from "../utils/access-code";

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

  it.each(["GET", "HEAD", "OPTIONS"])(
    "%s requests bypass the write gate",
    (method) => {
      expect(checkAccessCodeRequest(method, "/api/records", "", "", true)).toBe(
        "bypassed",
      );
    },
  );

  it("non-API writes bypass the gate", () => {
    expect(checkAccessCodeRequest("POST", "/health", "", "", true)).toBe(
      "bypassed",
    );
  });
});
