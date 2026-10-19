import {
  ProductRecordWithImageUrlsSchema,
  type ProductRecord,
} from "@scope/shared/schema";
import { describe, expect, it } from "vitest";
import { addImageUrls } from "./records.get";

const nowMs = 1_700_000_000_000;
const secret = Buffer.alloc(32, 1).toString("base64url");

describe("GET /api/records image URL fields", () => {
  it("adds a signed 60-second URL for every stored image", () => {
    const record = createRecord();
    const [response] = addImageUrls([record], secret, nowMs);

    expect(response?.images).toEqual(record.images);
    expect(response?.imageUrls).toHaveLength(record.images.length);
    const url = new URL(response!.imageUrls[0]!, "https://snap2sku.example");
    expect(url.pathname).toBe(`/api/uploads/${record.images[0]}`);
    expect(Number(url.searchParams.get("exp"))).toBe(1_700_000_060);
    expect(url.searchParams.get("sig")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ProductRecordWithImageUrlsSchema.safeParse(response).success).toBe(
      true,
    );
  });

  it("uses local unsigned paths only when signing is disabled", () => {
    const record = createRecord();
    const [response] = addImageUrls([record], "", nowMs);
    expect(response?.imageUrls).toEqual(
      record.images.map((imageId) => `/api/uploads/${imageId}`),
    );
  });
});

function createRecord(): ProductRecord {
  return {
    id: "b8d18f28-5964-4c9e-a2f8-0ae388a32d74",
    detailsVersion: 0,
    createdAt: "2026-10-09T00:00:00.000Z",
    durationMs: { uploadStart: 1, recognizedAt: 2, submittedAt: 3 },
    images: [
      "a0df5979-b3df-46c7-9c42-266729eb834b",
      "627c32ec-9844-49e9-90d8-0d1c1c90156c",
    ],
    recognize: {
      category: "外套",
      colors: [{ name: "藏青", hex: "#263A55" }],
      style: "通勤",
      seasons: ["春", "秋"],
      audience: "女",
      fabric: null,
      tagPrice: null,
      item_name: "藏青简约通勤外套",
      confidence: { category: 0.9, colors: 0.9, style: 0.9, overall: 0.9 },
    },
    edits: [],
    sku: [
      {
        color: "藏青",
        size: "M",
        stock: 3,
        tagPrice: 299,
        wholesalePrice: 120,
      },
    ],
    description: "",
    aiCorrect: {},
    costEstimate: 0,
  };
}
