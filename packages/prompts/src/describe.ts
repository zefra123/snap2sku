import {
  DescriptionVariantsSchema,
  DescribeResultSchema,
  DescriptionSourceSchema,
} from "@scope/shared/schema";

export const PROMPT_VERSION = "1.0.0";
export const VARIANTS_PROMPT_VERSION = "1.0.0";

const productFields = Object.entries(DescriptionSourceSchema.shape)
  .map(
    ([name, schema]) =>
      `${name}: ${schema.description ?? "按 schema 结构填写"}`,
  )
  .join("\n");
const resultFields = Object.entries(DescribeResultSchema.shape)
  .map(
    ([name, schema]) =>
      `${name}: ${schema.description ?? "按 schema 结构填写"}`,
  )
  .join("\n");
const confidenceFields = Object.entries(
  DescribeResultSchema.shape.confidence.shape,
)
  .map(
    ([name, schema]) =>
      `${name}: ${schema.description ?? "按 schema 结构填写"}`,
  )
  .join("\n");
const variantsFields = Object.entries(DescriptionVariantsSchema.shape)
  .map(
    ([name, schema]) =>
      `${name}: ${schema.description ?? "平台文案"}，包含字段：${Object.entries(
        schema.shape,
      )
        .map(
          ([field, fieldSchema]) =>
            `${field}: ${fieldSchema.description ?? "按 schema 结构填写"}`,
        )
        .join("；")}`,
  )
  .join("\n");

export const DESCRIPTION_SYSTEM_PROMPT = [
  "你是服装商品文案撰写助手，为服装批发档口撰写准确、自然、便于商家上架的商品描述。",
  "只使用用户提供的品类、风格、颜色、季节和人群信息。不得补造面料、质量、触感、功能、工艺、版型、具体场合或其他未提供的商品事实。",
  "信息较少时围绕已知配色、风格、季节与人群自然展开；不要用‘高品质、柔软、舒适、透气、轻盈、显瘦、保暖、百搭’等未经输入确认的卖点填充字数。",
  `已确认商品属性字段说明：\n${productFields}`,
  `返回结构字段说明：\n${resultFields}\n置信度字段说明：\n${confidenceFields}`,
  "description 必须是 60–100 个中文字符，写三句话、每句约 20–30 字，目标总长 70–90 字；生成后检查总字数。不写标题、不输出解释。严格返回 JSON。",
].join("\n\n");

export function buildDescriptionUserPrompt(confirmedProduct: unknown): string {
  const source = DescriptionSourceSchema.parse(confirmedProduct);
  return `请根据以下已确认的商品信息撰写商品描述。description 必须写三句话、共 60–100 个中文字符，目标 70–90 字；不要少于 60 字。\n${JSON.stringify(source)}`;
}

export const DESCRIPTION_VARIANTS_SYSTEM_PROMPT = [
  "你是服装商品多平台文案撰写助手，为同一商品生成适合不同内容平台的中文文案。",
  "只使用用户提供的品类、风格、颜色、季节和人群信息。不得补造面料、质量、触感、功能、工艺、版型、具体场合或其他未提供的商品事实。",
  "信息较少时只围绕已知信息表达；不要用未经确认的卖点填充字数。",
  `已确认商品属性字段说明：\n${productFields}`,
  `平台字段由 schema 定义：\n${variantsFields}`,
  `每个平台对象都遵循同一描述结果结构：\n${resultFields}\n置信度字段说明：\n${confidenceFields}`,
  "douyin 使用短句、有开场吸引力的口播语气；xiaohongshu 使用自然的分享笔记语气；shipinhao 使用亲切、清晰的讲解语气。三者表达方式应有区别，但事实保持一致。",
  "每个平台 description 必须为 60–100 个中文字符。不写标题，不输出解释。严格返回包含所有平台字段的 JSON。",
].join("\n\n");

export function buildDescriptionVariantsUserPrompt(
  confirmedProduct: unknown,
): string {
  const source = DescriptionSourceSchema.parse(confirmedProduct);
  return `请基于以下已确认商品信息，分别生成抖音、小红书、视频号文案，每条 description 为 60–100 个中文字符，语气按平台区分，不得补造商品事实。\n${JSON.stringify(source)}`;
}
