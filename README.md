# snap2sku

服装商品录入工作台：上传商品照片，识别商品资料，确认颜色与尺码 SKU，再保存本地录入记录。

## 本地运行

环境使用仓库锁定的 pnpm 11.19.0。Windows PowerShell 下启用无密钥演示模式：

```powershell
$env:NUXT_VISION_MOCK = '1'
pnpm dev
```

打开终端显示的本地地址。添加 JPG、PNG 或 WebP 图片后点击「识别商品」。模拟吊牌菜单提供两种固定结果：照片中可读到吊牌价（`tagPrice: 399`），以及未见吊牌（`tagPrice: null`）。图片仍经过本地上传接口，模拟结果不会请求视觉模型。

录入流程包含图片压缩、识别结果确认、SKU 库存/价格填写和本地记录保存。W1 的商品描述由用户手动补充；流式 AI 文案属于后续阶段。

上传图片写入项目根目录的 `data/uploads/`，录入记录写入 `data/records.json`。这些目录不位于 Nuxt `public/` 下，不作为静态资源公开。

真实视觉模型模式要求仅在本机服务端配置 `NUXT_VISION_API_KEY`；也可通过 `NUXT_VISION_MODEL` 和 `NUXT_VISION_BASE_URL` 设置模型与兼容 API 地址。不要把密钥提交到仓库或发送到聊天中。

## 检查

```powershell
pnpm typecheck
pnpm build
```

## 性能基准

基准用例为 1 色 × 500 码，共渲染 500 个 SKU 行。设备为 Windows 桌面环境、Codex 内置浏览器（CPU/RAM 型号因系统权限不可读取）；矩阵渲染实测约 328.2 ms，修改首个库存值到下一帧约 17.3 ms。帧间隔采样中记录到 3 次超过 25 ms 的间隔，说明极端矩阵下有少量掉帧；普通使用应以更小的实际 SKU 规模为准。此数据是当前设备的一次本地开发环境观测，不作为跨设备性能保证。

## 当前取舍

- **W1 使用 JSON + 原子写**：当前是本地、单机、低并发原型，JSON 便于直接检查和备份，不需要提前引入数据库；写入先落到同目录临时文件，再用 rename 原子替换，并在进程内排队，避免并发追加互相覆盖或留下半份 records.json。数据访问仍统一走 `server/utils/store.ts`。
- **DS-1 单屏流程**：上传、识别、确认和 SKU 编辑留在同一工作台，避免跨页丢失上下文；复杂表单和 SKU 矩阵会超出小屏视口，因此这里把“单屏”落实为单页面连续流程，允许正常纵向滚动，不为满足字面的一屏高度压缩字段或矩阵。PRD 中“不超过 1 屏滚动”的量化验收仍需结合真实设备复核。
- **无独立置信度的字段回退到 overall**：模型 schema 只提供 category、colors、style 的独立置信度；seasons、audience、fabric、item_name、tagPrice 没有独立评分。用 overall 显示统一的保守参考，避免伪造字段级分数；不会把某个其他字段的分数冒充为这些字段的置信度。

## 目录约定

- `apps/web/app/`：Nuxt 4 前端页面与唯一设计 token 文件。
- `apps/web/server/`：图片上传、识别和记录 API，以及服务端视觉模型适配器。
- `packages/shared/`：Zod schema、字段枚举和共享类型的唯一来源。
- `docs/`：产品契约、架构规划、W1 执行计划和约束。
