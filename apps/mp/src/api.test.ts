import { describe, expect, it } from "vitest";
import { RecognizeResultSchema } from "@scope/shared/schema";
import {
  apiErrorMessage,
  buildAccessHeaders,
  parseRecognizeResponse,
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
});
