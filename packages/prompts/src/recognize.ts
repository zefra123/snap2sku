import {
  AUDIENCES,
  CATEGORIES,
  ColorInfoSchema,
  RecognizeResultSchema,
  SEASONS,
  STYLES,
} from '@scope/shared/schema'

export const PROMPT_VERSION = '1.0.0'

export function buildRecognitionSystemPrompt(repairPrompt?: string): string {
  const fields = Object.entries(RecognizeResultSchema.shape)
    .map(([name, schema]) => `${name}: ${schema.description ?? '按 schema 结构填写'}`)
    .join('\n')
  const colorFields = Object.entries(ColorInfoSchema.shape)
    .map(([name, schema]) => `${name}: ${schema.description ?? '按 schema 结构填写'}`)
    .join('; ')

  return [
    '你是服装商品录入助手。只依据图片可见内容，禁止臆造；看不清面料或吊牌价格时填 null。',
    `严格输出 JSON，字段与要求如下：\n${fields}`,
    `category 必须来自：${JSON.stringify(CATEGORIES)}。`,
    `style 必须来自：${JSON.stringify(STYLES)}。`,
    `seasons 中的值必须来自：${JSON.stringify(SEASONS)}；audience 必须来自：${JSON.stringify(AUDIENCES)}。`,
    `colors 每项字段要求：${colorFields}。`,
    'confidence 中的各字段为 0 到 1 之间的置信度。',
    ...(repairPrompt ? [repairPrompt] : []),
    '只输出 JSON，不要解释或包裹 Markdown 代码块。',
  ].join('\n')
}

export function buildRecognitionUserPrompt(imageCount: number): string {
  return `这是同一件商品的第 1 张照片（共 ${imageCount} 张）。请识别并输出 JSON。`
}
