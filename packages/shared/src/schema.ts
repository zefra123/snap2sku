import { z } from "zod";

export const CATEGORIES = [
  "上衣",
  "裤装",
  "连衣裙",
  "外套",
  "半身裙",
  "套装",
  "鞋",
  "配饰",
  "其他",
] as const;
export const STYLES = [
  "通勤",
  "休闲",
  "甜美",
  "运动",
  "复古",
  "街头",
  "极简",
  "户外",
  "其他",
] as const;
export const SEASONS = ["春", "夏", "秋", "冬"] as const;
export const AUDIENCES = ["女", "男", "儿童", "中性"] as const;
export const SIZES_TOP = ["XS", "S", "M", "L", "XL", "XXL"] as const;

export const ColorInfoSchema = z.object({
  name: z.string().min(1).describe("中文颜色名"),
  hex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .describe("最接近的十六进制色值"),
});

export const RecognizeResultSchema = z.object({
  category: z.enum(CATEGORIES).describe("商品品类"),
  colors: z
    .array(ColorInfoSchema)
    .min(1)
    .max(4)
    .describe("主色调数组，按画面占比降序，最多 4 个"),
  style: z.enum(STYLES).describe("整体风格"),
  seasons: z.array(z.enum(SEASONS)).min(1).max(4).describe("适穿季节"),
  audience: z.enum(AUDIENCES).describe("目标人群"),
  fabric: z.string().nullable().describe("可见面料；无法判断填 null，禁止猜测"),
  tagPrice: z
    .number()
    .positive()
    .nullable()
    .describe(
      "仅从清晰可见的服装吊牌读取建议吊牌价；无法确认填 null，禁止猜测",
    ),
  item_name: z.string().min(8).max(16).describe("8–16 字的商品命名建议"),
  confidence: z.object({
    category: z.number().min(0).max(1).describe("品类置信度，0 到 1"),
    colors: z.number().min(0).max(1).describe("颜色置信度，0 到 1"),
    style: z.number().min(0).max(1).describe("风格置信度，0 到 1"),
    overall: z.number().min(0).max(1).describe("整体置信度，0 到 1"),
  }),
});

export const ModelUsageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});

export const RecognizeResponseSchema = z.object({
  result: RecognizeResultSchema,
  usage: ModelUsageSchema,
  costEstimate: z.number().nonnegative(),
});

export const DescriptionSourceSchema = RecognizeResultSchema.pick({
  category: true,
  style: true,
  colors: true,
  seasons: true,
  audience: true,
});

export const DescribeResultSchema = z.object({
  description: z.string().min(60).max(100).describe("60–100 字中文卖货描述"),
  confidence: z.object({
    description: z.number().min(0).max(1).describe("描述内容置信度，0 到 1"),
    overall: z.number().min(0).max(1).describe("整体置信度，0 到 1"),
  }),
});

export const DescriptionVariantsSchema = z.object({
  douyin: DescribeResultSchema.describe("抖音"),
  xiaohongshu: DescribeResultSchema.describe("小红书"),
  shipinhao: DescribeResultSchema.describe("视频号"),
});

export const UploadFileSchema = z.object({
  fileId: z.string().uuid(),
  originalName: z.string().min(1),
  storedAs: z.string().min(1),
  originalSize: z.number().int().nonnegative(),
  compressedSize: z.number().int().nonnegative(),
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

export const SKUItemSchema = z.object({
  color: z.string().min(1),
  size: z.string().min(1),
  stock: z.number().int().min(0),
  tagPrice: z.number().positive(),
  wholesalePrice: z.number().positive(),
});

export const ProductRecordSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  durationMs: z.object({
    uploadStart: z.number().nonnegative(),
    recognizedAt: z.number().nonnegative(),
    submittedAt: z.number().nonnegative(),
  }),
  images: z.array(z.string().uuid()).min(1),
  recognize: RecognizeResultSchema,
  edits: z.array(
    z.object({
      field: z.string().min(1),
      from: z.unknown(),
      to: z.unknown(),
      isCorrection: z.boolean(),
    }),
  ),
  sku: z.array(SKUItemSchema).min(1),
  description: z.string(),
  descriptionAi: z.string().optional(),
  descriptionVariantsAi: DescriptionVariantsSchema.optional(),
  aiCorrect: z.record(z.string(), z.boolean()),
  costEstimate: z.number().nonnegative(),
});

export type RecognizeResult = z.infer<typeof RecognizeResultSchema>;
export type ModelUsage = z.infer<typeof ModelUsageSchema>;
export type RecognizeResponse = z.infer<typeof RecognizeResponseSchema>;
export type DescriptionSource = z.infer<typeof DescriptionSourceSchema>;
export type DescribeResult = z.infer<typeof DescribeResultSchema>;
export type DescriptionVariants = z.infer<typeof DescriptionVariantsSchema>;
export type DescriptionPlatform = keyof typeof DescriptionVariantsSchema.shape;
export type UploadFile = z.infer<typeof UploadFileSchema>;
export type SKUItem = z.infer<typeof SKUItemSchema>;
export type ProductRecord = z.infer<typeof ProductRecordSchema>;

export const RECOGNIZE_FIELD_NAMES = Object.keys(
  RecognizeResultSchema.shape,
) as (keyof RecognizeResult)[];
