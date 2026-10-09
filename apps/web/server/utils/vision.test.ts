import { describe, expect, it } from "vitest";
import {
  DescribeResultSchema,
  RecognizeResponseSchema,
  RecognizeResultSchema,
} from "@scope/shared/schema";
import {
  calculateRecognitionCost,
  createMockRecognizeResponse,
  getMockRecognizeResult,
  normalizeGeneratedDescription,
  normalizeRecognizeResult,
  parseModelUsage,
} from "./vision";

describe("visual adapter mock fixtures", () => {
  it("parses model token usage and estimates input/output cost per million tokens", () => {
    const usage = parseModelUsage({
      usage: {
        prompt_tokens: 1250,
        completion_tokens: 250,
        total_tokens: 1500,
      },
    });

    expect(usage).toEqual({
      prompt_tokens: 1250,
      completion_tokens: 250,
      total_tokens: 1500,
    });
    expect(calculateRecognitionCost(usage, 2, 8)).toBe(0.0045);
  });

  it("keeps mock usage and estimated cost valid and at zero", () => {
    const response = createMockRecognizeResponse("tagPrice");

    expect(RecognizeResponseSchema.safeParse(response).success).toBe(true);
    expect(response.usage).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    });
    expect(response.costEstimate).toBe(0);
  });

  it("retains the tag-price and no-tag-price fixtures without model calls", () => {
    const withPrice = getMockRecognizeResult("tagPrice");
    const withoutPrice = getMockRecognizeResult("noTagPrice");

    expect(RecognizeResultSchema.safeParse(withPrice).success).toBe(true);
    expect(withPrice.tagPrice).toBe(399);
    expect(RecognizeResultSchema.safeParse(withoutPrice).success).toBe(true);
    expect(withoutPrice.tagPrice).toBeNull();
  });

  it("normalizes an information-poor fixture into a valid low-confidence result", () => {
    const result = getMockRecognizeResult("allNull");

    expect(RecognizeResultSchema.safeParse(result).success).toBe(true);
    expect(result.category).toBe("其他");
    expect(result.confidence.overall).toBeLessThanOrEqual(0.4);
    expect(result.tagPrice).toBeNull();
  });

  it("falls back unsupported model enums and short names while lowering confidence", () => {
    const result = RecognizeResultSchema.parse(
      normalizeRecognizeResult({
        category: "泳衣",
        colors: [{ name: "黑色", hex: "#000000" }],
        style: "性感",
        seasons: ["夏"],
        audience: "女性",
        fabric: "网纱",
        tagPrice: null,
        item_name: "网纱比基尼",
        confidence: {
          category: 0.9,
          colors: 0.9,
          style: 0.9,
          overall: 0.9,
        },
      }),
    );

    expect(result.category).toBe("其他");
    expect(result.style).toBe("其他");
    expect(result.audience).toBe("女");
    expect(result.item_name).toBe("待人工确认的服装商品");
    expect(result.confidence.overall).toBe(0.4);
  });

  it("falls back empty or unsupported colors and seasons", () => {
    const result = RecognizeResultSchema.parse(
      normalizeRecognizeResult({
        category: "上衣",
        colors: [],
        style: "休闲",
        seasons: ["梅雨"],
        audience: "中性",
        fabric: null,
        tagPrice: null,
        item_name: "待人工确认的服装商品",
        confidence: {
          category: 0.8,
          colors: 0.8,
          style: 0.8,
          overall: 0.8,
        },
      }),
    );

    expect(result.colors).toEqual([{ name: "其他", hex: "#808080" }]);
    expect(result.seasons).toEqual(["秋"]);
    expect(result.confidence.overall).toBe(0.4);
  });

  it("extends a short model description within the schema and marks it for review", () => {
    const result = DescribeResultSchema.parse(
      normalizeGeneratedDescription({
        description:
          "这款时尚女装专为秋季设计，采用经典黑色调，简约而不失优雅。",
        confidence: { description: 0.9, overall: 0.9 },
      }),
    );

    expect(Array.from(result.description).length).toBeGreaterThanOrEqual(60);
    expect(Array.from(result.description).length).toBeLessThanOrEqual(100);
    expect(result.confidence.description).toBe(0.4);
    expect(result.confidence.overall).toBe(0.4);
  });
});
