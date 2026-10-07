# 识别 Prompt 与 Zod Schema · 初稿

用途：Day 3（10/8）直接抄进 `packages/prompts` 和 `packages/shared`。
状态：v1 起步版，W1 结束后根据 badcase 迭代到 v2，并保留版本记录（prompt 版本化本身是面试考点）。

---

## 一、Zod Schema（packages/shared/schema.ts）

```ts
import { z } from 'zod'

// 枚举集中定义，表单选项从这里生成，不手写第二份
export const CATEGORIES = ['上衣', '裤装', '连衣裙', '外套', '半身裙', '套装', '鞋', '配饰', '其他'] as const
export const STYLES = ['通勤', '休闲', '甜美', '运动', '复古', '街头', '极简', '户外', '其他'] as const
export const SEASONS = ['春', '夏', '秋', '冬'] as const
export const AUDIENCES = ['女', '男', '儿童', '中性'] as const
export const SIZES_TOP = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const

export const ColorInfo = z.object({
  name: z.string().describe('中文颜色名，如「藏青」'),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).describe('最接近的十六进制色值'),
})

export const RecognizeResult = z.object({
  category: z.enum(CATEGORIES).describe('商品品类'),
  colors: z.array(ColorInfo).min(1).max(4).describe('识别出的主色调，按占比降序'),
  style: z.enum(STYLES).describe('整体风格'),
  seasons: z.array(z.enum(SEASONS)).min(1).max(4).describe('适穿季节'),
  audience: z.enum(AUDIENCES).describe('目标人群'),
  fabric: z.string().nullable().describe('可见面料猜测，如「棉」「聚酯纤维」，看不出填 null'),
  tagPrice: z.number().positive().nullable().describe('从照片吊牌读出的建议吊牌价（元），吊牌不可见或不清晰填 null，禁止猜'),
  item_name: z.string().describe('8-16 字商品命名建议，如「复古刺绣宽松牛仔外套」'),
  confidence: z.object({
    category: z.number().min(0).max(1),
    colors: z.number().min(0).max(1),
    style: z.number().min(0).max(1),
    overall: z.number().min(0).max(1).describe('整体置信度'),
  }),
})

export type RecognizeResult = z.infer<typeof RecognizeResult>
```

**设计要点（记进 README 取舍）**：
- 枚举用 `as const` + `z.enum`，表单和 prompt 共用同一份常量——改一处全生效
- `confidence` 拆成逐字段，前端只对标黄低置信项，不用全量人工复核
- `fabric` 允许 null：逼着模型承认「看不出」比瞎编好，这是避免幻觉的第一道闸
- `tagPrice` 同样允许 null（V1.3 与 PRD 对齐）：吊牌价只读照片里真实印的数字，读不到就 null——「AI 会看吊牌」是档口场景的记忆点，但宁缺勿编

---

## 二、识别 Prompt（packages/prompts/recognize.ts）

```ts
export const RECOGNIZE_SYSTEM = `你是一名服装行业的商品数据录入专家，为一家服装批发档口的进销存系统工作。

任务：看服装商品照片，输出结构化的商品属性，用于预填录入表单。

要求：
1. 只依据照片中可见的信息判断，不要臆造照片里不存在的内容
2. fabric 与 tagPrice 字段：照片无法判断时必须填 null，禁止猜（吊牌上的价格清晰可见时才填数字）
3. 颜色给出主色调即可，按画面占比从高到低排序，最多 4 个
4. item_name 要像真实电商商品标题，突出品类和卖点，8-16 个字
5. 严格输出 JSON，不要输出任何解释、前后缀或 markdown 代码块

输出格式（字段名和结构必须完全一致）：
{
  "category": "<CATEGORIES 之一>",
  "colors": [{ "name": "<中文颜色名>", "hex": "#RRGGBB" }],
  "style": "<STYLES 之一>",
  "seasons": ["<SEASONS 之一或多个>"],
  "audience": "<AUDIENCES 之一>",
  "fabric": "<面料或 null>",
  "tagPrice": <吊牌价数字或 null>,
  "item_name": "<商品命名建议>",
  "confidence": { "category": 0.0, "colors": 0.0, "style": 0.0, "overall": 0.0 }
}`

export const RECOGNIZE_USER = (imageCount: number) =>
  `这是同一件商品的第 1 张照片（共 ${imageCount} 张）。请识别并输出 JSON。`
```

**设计要点**：
- 给模型一个具体身份（档口录入员）比「你是助手」输出稳定得多
- 「禁止猜、看不出填 null」这条是拿真实 badcase 换来的经验，W1 观察期重点看它生效没有
- 枚举值不硬编码进 prompt 正文的话，调用时要把 `CATEGORIES` 等常量拼接进模板——保持 schema 与 prompt 的单一来源

---

## 三、调用侧重试逻辑（apps/web/server/api/recognize.post.ts 的骨架）

```ts
import { RecognizeResult } from '@scope/shared/schema'

export default defineEventHandler(async (event) => {
  const { imageBase64 } = await readBody(event)
  const config = useRuntimeConfig()

  const raw = await callVisionModel(imageBase64, {
    apiKey: config.visionApiKey,
    system: RECOGNIZE_SYSTEM,
    user: RECOGNIZE_USER(1),
  })

  // 1. 剥掉可能的 ```json 包裹
  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, '')

  // 2. zod 校验，失败带错误重试一次
  let parsed = RecognizeResult.safeParse(JSON.parse(cleaned))
  if (!parsed.success) {
    const retryRaw = await callVisionModel(imageBase64, {
      apiKey: config.visionApiKey,
      system: RECOGNIZE_SYSTEM,
      user: `${RECOGNIZE_USER(1)}\n\n你上次的输出未通过校验：${parsed.error.message}\n请严格按格式重新输出。`,
    })
    const retryCleaned = retryRaw.replace(/^```(?:json)?\s*|\s*```$/g, '')
    parsed = RecognizeResult.safeParse(JSON.parse(retryCleaned))
  }

  if (!parsed.success) {
    throw createError({ statusCode: 422, statusMessage: '识别结果校验失败' })
  }
  return parsed.data
})
```

**注意**：
- `JSON.parse` 抛错要 try/catch 包住再走重试，别让 500 直接冒出去
- API key 只从 `runtimeConfig` 读，来自服务端环境变量，`nuxt.config` 里只留 key 名

---

## 四、W1 观察清单（识别质量的 badcase 记录格式）

每天录完衣服，把翻车案例按这个格式记一行（后续就是评测报告的原材料）：

```
[日期] 图片: uploads/xx.jpg | 现象: 把米色认成了白色
       字段: colors | 模型输出: 米色 | 人工标注: 奶白 | 处置: prompt 加了色系提示/不改
```

W4 做 50 张标注评测时，这份流水就是「你为什么改 prompt」的全部证据链。
