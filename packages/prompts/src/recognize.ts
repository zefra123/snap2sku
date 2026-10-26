import {
  AUDIENCES,
  CATEGORIES,
  ColorInfoSchema,
  PLACEHOLDER_ITEM_NAME,
  RecognizeResultSchema,
  SEASONS,
  STYLES,
} from "@scope/shared/schema";

export const PROMPT_VERSION = "1.0.2";

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
    `item_name 必须根据已识别的 category、style、colors 组合成 8–16 字的具体中文商品名，例如“甜美粉色针织连衣裙”或“休闲藏青宽松针织开衫”。只要 category、style、colors 中至少两项可判断，就必须生成具体名称，不得使用占位文案；只有图片中完全看不出服装主体且这些信息都不足以命名时，才写“${PLACEHOLDER_ITEM_NAME}”。`,
    `category、style、audience、seasons、colors 和 item_name 不得输出 null。无法判断时 category/style 选“其他”，audience 选“中性”，colors 使用 {"name":"其他","hex":"#808080"}，seasons 选择最接近的选项。fabric 与 tagPrice 无法判断时仍填 null，禁止猜测。`,
    "无法判断的字段及 confidence.overall 置信度必须不高于 0.4，以便人工复核。",
    "confidence 中的各字段为 0 到 1 之间的置信度。",
    ...(repairPrompt ? [repairPrompt] : []),
    "只输出 JSON，不要解释或包裹 Markdown 代码块。",
  ].join("\n");
}

export function buildRecognitionUserPrompt(imageCount: number): string {
  return `下面提供 ${imageCount} 张同一件商品的照片，可能包含商品全貌、细节和吊牌。请综合所有照片识别，只生成一份商品资料；吊牌价仅在任一照片中清晰可读时填写，否则填 null。请输出 JSON。`;
}
