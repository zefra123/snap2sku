import {
  AUDIENCES,
  CATEGORIES,
  ColorInfoSchema,
  PLACEHOLDER_ITEM_NAME,
  RecognizeResultSchema,
  SEASONS,
  STYLES,
} from "@scope/shared/schema";

export const PROMPT_VERSION = "1.0.0";

export function buildRecognitionSystemPrompt(repairPrompt?: string): string {
  const fields = Object.entries(RecognizeResultSchema.shape)
    .map(
      ([name, schema]) =>
        `${name}: ${schema.description ?? "按 schema 结构填写"}`,
    )
    .join("\n");
  const colorFields = Object.entries(ColorInfoSchema.shape)
    .map(
      ([name, schema]) =>
        `${name}: ${schema.description ?? "按 schema 结构填写"}`,
    )
    .join("; ");

  return [
    "你是服装商品录入助手。只依据图片可见内容，禁止臆造；看不清面料或吊牌价格时填 null。",
    `严格输出 JSON，字段与要求如下：\n${fields}`,
    `category 必须来自：${JSON.stringify(CATEGORIES)}。`,
    `style 必须来自：${JSON.stringify(STYLES)}。`,
    `seasons 中的值必须来自：${JSON.stringify(SEASONS)}；audience 必须来自：${JSON.stringify(AUDIENCES)}。`,
    `colors 每项字段要求：${colorFields}。`,
    `item_name 必须根据已识别的 category、style、colors 组合成 8–16 字的具体中文商品名，例如“甜美粉色针织连衣裙”或“休闲藏青宽松针织开衫”；只有在图片中完全看不出服装主体时，才写占位文案“${PLACEHOLDER_ITEM_NAME}”。`,
    `category、style、audience、seasons、colors 和 item_name 不得输出 null。无法判断时 category/style 选“其他”，audience 选“中性”，colors 使用 {"name":"其他","hex":"#808080"}，seasons 选择最接近的选项。fabric 与 tagPrice 无法判断时仍填 null，禁止猜测。`,
    "无法判断的字段及 confidence.overall 置信度必须不高于 0.4，以便人工复核。",
    "confidence 中的各字段为 0 到 1 之间的置信度。",
    ...(repairPrompt ? [repairPrompt] : []),
    "只输出 JSON，不要解释或包裹 Markdown 代码块。",
  ].join("\n");
}

export function buildRecognitionUserPrompt(imageCount: number): string {
  return `这是同一件商品的第 1 张照片（共 ${imageCount} 张）。请识别并输出 JSON。`;
}
