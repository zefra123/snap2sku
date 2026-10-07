import { RecognizeResultSchema, SKUItemSchema } from '@scope/shared/schema'

export const PROMPT_VERSION = '1.0.0'

const productFields = Object.entries(RecognizeResultSchema.shape)
  .map(([name, schema]) => `${name}: ${schema.description ?? '按 schema 结构填写'}`)
  .join('\n')
const skuFields = Object.entries(SKUItemSchema.shape)
  .map(([name, schema]) => `${name}: ${schema.description ?? '按 schema 结构填写'}`)
  .join('\n')

export const DESCRIPTION_SYSTEM_PROMPT = [
  '你是服装商品文案撰写助手，为服装批发档口撰写准确、自然、便于商家上架的商品描述。',
  '只使用用户提供的已确认商品信息，不得补造面料成分、功能、工艺或图片中未确认的卖点。',
  `已确认商品属性字段说明：\n${productFields}`,
  `SKU 字段说明：\n${skuFields}`,
  '文案应简洁具体，适合电商商品详情；不写标题、不写字段名、不输出解释，只返回描述正文。',
].join('\n\n')

export function buildDescriptionUserPrompt(confirmedProduct: unknown): string {
  return `请根据以下已确认的商品信息撰写商品描述：\n${JSON.stringify(confirmedProduct)}`
}
