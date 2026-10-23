import { describe, expect, it } from "vitest";
import { signUploadUrl, verifyUploadSignature } from "./signing";

const fileId = "a0df5979-b3df-46c7-9c42-266729eb834b";
const currentSecret = Buffer.alloc(32, 1).toString("base64url");
const previousSecret = Buffer.alloc(32, 2).toString("base64url");
const nowMs = 1_700_000_000_000;

describe("temporary upload signatures", () => {
  it("signs the file ID and expiration for a 60 second URL", () => {
    const url = new URL(
      signUploadUrl(fileId, 60, currentSecret, nowMs),
      "https://snap2sku.example",
    );
    expect(url.pathname).toBe(`/api/uploads/${fileId}`);
    expect(url.searchParams.get("exp")).toBe("1700000060");
    expect(
      verifyUploadSignature(
        fileId,
        url.searchParams.get("exp"),
        url.searchParams.get("sig"),
        currentSecret,
        "",
        nowMs,
      ),
    ).toBe(true);
  });

  it("rejects tampered, expired, malformed and overlong signatures", () => {
    const url = new URL(
      signUploadUrl(fileId, 60, currentSecret, nowMs),
      "https://snap2sku.example",
    );
    expect(
      verifyUploadSignature(
        fileId,
        url.searchParams.get("exp"),
        `${url.searchParams.get("sig")?.slice(0, -1)}${url.searchParams.get("sig")?.endsWith("A") ? "B" : "A"}`,
        currentSecret,
        "",
        nowMs,
      ),
    ).toBe(false);
    expect(
      verifyUploadSignature(
        fileId,
        "not-a-time",
        url.searchParams.get("sig"),
        currentSecret,
        "",
        nowMs,
      ),
    ).toBe(false);
    expect(
      verifyUploadSignature(
        fileId,
        url.searchParams.get("exp"),
        url.searchParams.get("sig"),
        currentSecret,
        "",
        nowMs + 60_000,
      ),
    ).toBe(false);
    expect(() => signUploadUrl(fileId, 61, currentSecret, nowMs)).toThrow(
      "1–60 秒",
    );
  });

  it("accepts signatures from the previous secret during rotation", () => {
    const url = new URL(
      signUploadUrl(fileId, 60, previousSecret, nowMs),
      "https://snap2sku.example",
    );
    expect(
      verifyUploadSignature(
        fileId,
        url.searchParams.get("exp"),
        url.searchParams.get("sig"),
        currentSecret,
        previousSecret,
        nowMs,
      ),
    ).toBe(true);
  });

  it("creates an unsigned local URL when signing is disabled in development", () => {
    expect(signUploadUrl(fileId, 60, "", nowMs)).toBe(`/api/uploads/${fileId}`);
  });
});
