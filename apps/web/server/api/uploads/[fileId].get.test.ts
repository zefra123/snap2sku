import { createError, type H3Event } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { closeStore, initializeStore, uploadPath } from "../../utils/store";
import { signUploadUrl } from "../../utils/signing";
import { handleUploadedImage } from "./[fileId].get";

const fileId = "a0df5979-b3df-46c7-9c42-266729eb834b";
const currentSecret = Buffer.alloc(32, 1).toString("base64url");
const previousSecret = Buffer.alloc(32, 2).toString("base64url");
const nowMs = 1_700_000_000_000;

let temporaryDirectory: string | undefined;

beforeEach(() => {
  vi.stubGlobal("createError", createError);
});

afterEach(() => {
  vi.unstubAllGlobals();
  closeStore();
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  temporaryDirectory = undefined;
});

describe("GET /api/uploads/:fileId", () => {
  it("serves signed image bytes with private cache headers", async () => {
    const image = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
    prepareImage(`${fileId}.jpg`, image);
    const signedUrl = new URL(
      signUploadUrl(fileId, 60, currentSecret, nowMs),
      "https://snap2sku.example",
    );
    const { event, headers } = createEvent(fileId, signedUrl.search);

    const response = await handleUploadedImage(
      event,
      { currentSecret, previousSecret: "", isProduction: true },
      nowMs,
    );

    expect(response).toEqual(image);
    expect(headers).toMatchObject({
      "content-type": "image/jpeg",
      "content-length": image.byteLength,
      "cache-control": "private, max-age=60",
    });
  });

  it("rejects missing, invalid and expired signatures", async () => {
    prepareImage(`${fileId}.png`, Buffer.from("png"));
    const noSignature = createEvent(fileId, "");
    await expect(
      handleUploadedImage(
        noSignature.event,
        { currentSecret, previousSecret: "", isProduction: true },
        nowMs,
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { code: "E_SIGNATURE_INVALID" },
    });

    const validUrl = new URL(
      signUploadUrl(fileId, 60, currentSecret, nowMs),
      "https://snap2sku.example",
    );
    const signature = validUrl.searchParams.get("sig") ?? "";
    validUrl.searchParams.set(
      "sig",
      `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`,
    );
    const invalidSignature = createEvent(fileId, validUrl.search);
    await expect(
      handleUploadedImage(
        invalidSignature.event,
        { currentSecret, previousSecret: "", isProduction: true },
        nowMs,
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { code: "E_SIGNATURE_INVALID" },
    });

    const expiredUrl = new URL(
      signUploadUrl(fileId, 60, currentSecret, nowMs - 60_000),
      "https://snap2sku.example",
    );
    const expired = createEvent(fileId, expiredUrl.search);
    await expect(
      handleUploadedImage(
        expired.event,
        { currentSecret, previousSecret: "", isProduction: true },
        nowMs,
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { code: "E_SIGNATURE_INVALID" },
    });
  });

  it("accepts a URL signed with the previous secret during rotation", async () => {
    const image = Buffer.from("webp");
    prepareImage(`${fileId}.webp`, image);
    const signedUrl = new URL(
      signUploadUrl(fileId, 60, previousSecret, nowMs),
      "https://snap2sku.example",
    );
    const { event } = createEvent(fileId, signedUrl.search);

    await expect(
      handleUploadedImage(
        event,
        { currentSecret, previousSecret, isProduction: true },
        nowMs,
      ),
    ).resolves.toEqual(image);
  });

  it("rejects invalid IDs and unsupported extensions", async () => {
    prepareImage(`${fileId}.txt`, Buffer.from("must not be returned"));
    const invalid = createEvent("..%2f", "");
    await expect(
      handleUploadedImage(
        invalid.event,
        { currentSecret, previousSecret: "", isProduction: true },
        nowMs,
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { code: "E_VALIDATION" },
    });

    const signedUrl = new URL(
      signUploadUrl(fileId, 60, currentSecret, nowMs),
      "https://snap2sku.example",
    );
    const unsupported = createEvent(fileId, signedUrl.search);
    await expect(
      handleUploadedImage(
        unsupported.event,
        { currentSecret, previousSecret: "", isProduction: true },
        nowMs,
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      data: { code: "E_FILE_NOT_FOUND" },
    });
  });

  it("returns 404 for an unknown UUID and never exposes files outside uploads", async () => {
    prepareImage(`${fileId}.jpg`, Buffer.from("known image"));
    const sentinel = "outside-upload-directory-secret";
    writeFileSync(join(temporaryDirectory!, "sentinel.txt"), sentinel);

    const missingId = "d6bf018a-8875-42c5-b4b0-529f52336e70";
    const missingUrl = new URL(
      signUploadUrl(missingId, 60, currentSecret, nowMs),
      "https://snap2sku.example",
    );
    const missing = createEvent(missingId, missingUrl.search);
    await expect(
      handleUploadedImage(
        missing.event,
        { currentSecret, previousSecret: "", isProduction: true },
        nowMs,
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      data: { code: "E_FILE_NOT_FOUND" },
    });

    const invalidErrors: unknown[] = [];
    for (const invalidId of ["../", "..%2f", "a".repeat(300), "not-a-uuid"]) {
      const invalid = createEvent(invalidId, "");
      const error = await handleUploadedImage(
        invalid.event,
        { currentSecret, previousSecret: "", isProduction: true },
        nowMs,
      ).catch((caught: unknown) => caught);
      invalidErrors.push(error);
      expect(error).toMatchObject({
        statusCode: 400,
        data: { code: "E_VALIDATION" },
      });
    }
    expect(JSON.stringify(invalidErrors)).not.toContain(sentinel);
  });

  it("allows unsigned local reads only in development and marks the response", async () => {
    const image = Buffer.from("local image");
    prepareImage(`${fileId}.png`, image);
    const { event, headers } = createEvent(fileId, "");

    await expect(
      handleUploadedImage(
        event,
        { currentSecret: "", previousSecret: "", isProduction: false },
        nowMs,
      ),
    ).resolves.toEqual(image);
    expect(headers["x-upload-signature"]).toBe("disabled");
  });
});

function prepareImage(fileName: string, contents: Buffer): void {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "snap2sku-upload-read-"));
  initializeStore(temporaryDirectory);
  const path = uploadPath(fileName);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function createEvent(
  imageId: string,
  query: string,
): { event: H3Event; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const event = {
    path: `/api/uploads/${imageId}${query}`,
    context: { params: { fileId: imageId } },
    node: {
      req: {
        method: "GET",
        url: `/api/uploads/${imageId}${query}`,
        headers: { host: "localhost" },
      },
      res: {
        setHeader(name: string, value: string) {
          headers[name.toLowerCase()] = value;
        },
        getHeader(name: string) {
          return headers[name.toLowerCase()];
        },
      },
    },
  } as unknown as H3Event;
  return { event, headers };
}
