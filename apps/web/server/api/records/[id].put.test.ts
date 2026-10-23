import { beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";
import {
  ProductRecordWithImageUrlsSchema,
  type ProductRecord,
} from "@scope/shared/schema";

vi.mock("../../utils/store", () => ({
  updateRecordDetails: vi.fn(),
}));

import { updateRecordDetails } from "../../utils/store";

const secret = Buffer.alloc(32, 3).toString("base64url");
let putRecordHandler: (event: H3Event) => Promise<unknown>;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("useRuntimeConfig", () => ({ uploadSigningSecret: secret }));
  vi.stubGlobal(
    "defineEventHandler",
    (handler: (event: H3Event) => unknown) => handler,
  );
  vi.stubGlobal(
    "getRouterParam",
    (event: H3Event, key: string) => event.context.params?.[key],
  );
  vi.stubGlobal(
    "readBody",
    async (event: H3Event) => (event.context as { body: unknown }).body,
  );
  putRecordHandler = (await import("./[id].put"))
    .default as typeof putRecordHandler;
});

describe("PUT /api/records/:id", () => {
  it("returns a schema-valid record with a freshly signed image URL", async () => {
    const record = createRecord();
    vi.mocked(updateRecordDetails).mockResolvedValue({
      kind: "updated",
      record,
    });
    const event = {
      context: {
        params: { id: record.id },
        body: {
          detailsVersion: record.detailsVersion,
          recognize: record.recognize,
          sku: record.sku,
        },
      },
    } as unknown as H3Event;

    const response = await putRecordHandler(event);

    expect(ProductRecordWithImageUrlsSchema.safeParse(response).success).toBe(
      true,
    );
    expect(response).toMatchObject({
      id: record.id,
      imageUrls: [expect.stringMatching(/\?exp=\d+&sig=[A-Za-z0-9_-]{43}$/)],
    });
  });
});

function createRecord(): ProductRecord {
  return {
    id: "b8d18f28-5964-4c9e-a2f8-0ae388a32d74",
    detailsVersion: 1,
    createdAt: "2026-10-09T00:00:00.000Z",
    durationMs: { uploadStart: 1, recognizedAt: 2, submittedAt: 3 },
    images: ["a0df5979-b3df-46c7-9c42-266729eb834b"],
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
