import { describe, expect, it, vi } from "vitest";
import { MAX_UPLOAD_BYTES } from "@scope/shared/schema";
import {
  fitWithinMaxEdge,
  prepareImageForUpload,
  type ImageProcessingApi,
} from "./image";

describe("mini program image preparation", () => {
  it("keeps aspect ratio and constrains the longest edge to 1024px", () => {
    expect(fitWithinMaxEdge({ width: 4000, height: 3000 })).toEqual({
      width: 1024,
      height: 768,
    });
    expect(fitWithinMaxEdge({ width: 800, height: 600 })).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("compresses at quality 85 and returns the compressed path", async () => {
    const compressImage = vi.fn(async () => "/tmp/compressed.jpg");
    const api: ImageProcessingApi = {
      getImageInfo: async () => ({ width: 4000, height: 3000 }),
      compressImage,
    };

    await expect(
      prepareImageForUpload("/tmp/original.jpg", 8_000_000, api),
    ).resolves.toEqual({
      path: "/tmp/compressed.jpg",
      compressed: true,
    });
    expect(compressImage).toHaveBeenCalledWith({
      src: "/tmp/original.jpg",
      quality: 85,
      compressedWidth: 1024,
      compressedHeight: 768,
    });
  });

  it("falls back to an original within the server limit when compression fails", async () => {
    const api: ImageProcessingApi = {
      getImageInfo: async () => ({ width: 4000, height: 3000 }),
      compressImage: async () => {
        throw new Error("compress failed");
      },
    };

    await expect(
      prepareImageForUpload("/tmp/original.jpg", MAX_UPLOAD_BYTES, api),
    ).resolves.toEqual({
      path: "/tmp/original.jpg",
      compressed: false,
    });
  });

  it("rejects an oversized original when compression fails", async () => {
    const api: ImageProcessingApi = {
      getImageInfo: async () => ({ width: 4000, height: 3000 }),
      compressImage: async () => {
        throw new Error("compress failed");
      },
    };

    await expect(
      prepareImageForUpload("/tmp/original.jpg", MAX_UPLOAD_BYTES + 1, api),
    ).rejects.toThrow("E_SIZE");
  });
});
