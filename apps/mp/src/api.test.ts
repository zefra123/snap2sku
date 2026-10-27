import { describe, expect, it } from "vitest";
import { RecognizeResultSchema } from "@scope/shared/schema";
import {
  apiErrorMessage,
  buildAccessHeaders,
  parseRecognizeResponse,
  parseProductRecordList,
  parseSseEvents,
} from "./api";

describe("mini program API contracts", () => {
  it("validates recognize responses with the shared schema", () => {
    const response = {
      result: {
        category: "外套",
        colors: [{ name: "藏青", hex: "#263A55" }],
        style: "通勤",
        seasons: ["秋"],
        audience: "女",
        fabric: null,
        tagPrice: null,
        item_name: "藏青简约通勤外套",
        confidence: { category: 0.9, colors: 0.9, style: 0.9, overall: 0.9 },
      },
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      costEstimate: 0.001,
    };
    expect(RecognizeResultSchema.safeParse(response.result).success).toBe(true);
    expect(parseRecognizeResponse(response).result).toEqual(response.result);
    expect(() =>
      parseRecognizeResponse({
        ...response,
        result: { ...response.result, category: "未知" },
      }),
    ).toThrow("E_RECOGNIZE_INVALID");
  });

  it("adds the access code header to write requests", () => {
    expect(buildAccessHeaders("demo-code")).toEqual({
      "x-access-code": "demo-code",
    });
  });

  it("validates records with the shared schema and retains signed image URLs", () => {
    const record = {
      id: "d1064e86-768f-447f-a0cb-81ae6e59cad1",
      detailsVersion: 0,
      createdAt: "2026-10-26T00:00:00.000Z",
      durationMs: { uploadStart: 1, recognizedAt: 2, submittedAt: 3 },
      images: ["d1064e86-768f-447f-a0cb-81ae6e59cad2"],
      imageUrls: ["/api/uploads/photo.jpg?exp=123&sig=signature"],
      recognize: {
        category: "外套",
        colors: [{ name: "藏青", hex: "#263A55" }],
        style: "通勤",
        seasons: ["秋"],
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
          stock: 1,
          tagPrice: 399,
          wholesalePrice: 120,
        },
      ],
      description: "",
      aiCorrect: {},
      costEstimate: 0,
    };
    expect(parseProductRecordList([record])[0]?.imageUrls).toEqual(
      record.imageUrls,
    );
  });

  it("parses named SSE events returned as a complete response", () => {
    expect(
      parseSseEvents(
        'event: generated\ndata: {"confidence":{"overall":0.6}}\n\nevent: done\ndata: [DONE]\n\n',
      ),
    ).toEqual([
      { event: "generated", data: '{"confidence":{"overall":0.6}}' },
      { event: "done", data: "[DONE]" },
    ]);
  });

  it("maps missing uploaded images to an actionable error", () => {
    expect(
      apiErrorMessage(400, {
        data: {
          code: "E_IMAGE_MISSING",
          message: "有图片已失效，请重新上传后再提交",
        },
      }),
    ).toBe("E_IMAGE_MISSING: 图片已失效，请重新选择照片并重新识别后再提交");
  });

  it("maps an exhausted trial budget to an actionable error", () => {
    expect(
      apiErrorMessage(402, {
        data: {
          code: "E_BUDGET_EXHAUSTED",
          message: "试用额度已用完，请稍后再试",
        },
      }),
    ).toBe("E_BUDGET_EXHAUSTED: 试用额度已用完，请稍后再试");
  });
});
