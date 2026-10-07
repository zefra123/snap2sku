# snap2sku 代码审查报告 · W1 D2（2026-10-07）

> 审查人：栈师（独立复核）｜ 审查对象：commit 前工作区（git 尚未初始化）
> 方法：逐文件读源码 + 本机实跑 `pnpm typecheck`（通过）/ `pnpm build`（首次因目录占用在 clearDir 阶段失败，重跑通过，见 P2-9），对照 `docs/PRD-AI商品录入助手-v1.0.md` V1.3、`docs/W1-执行计划.md`、`AGENTS.md` 三条基准。所有结论均有文件行号，未采信口述汇报。

---

## 一、结论

**W1 的 D1–D5 主干已经提前完成，且质量高于计划预期**：全链路（上传→压缩→识别→表单确认→SKU→提交→落盘）无密钥可跑通，`packages/prompts` 已拆包并独立版本化，JSON 存储按新拍的存储约束做了原子写 + 串行队列。

**判定：D3 的「真实验收」未完成（无 key），D6 的记录列表页未开工，D5 的 500 格性能基准未做；另有 3 项 PRD 硬规范未落实（刻度尺、单屏流程、字体加载）。**

| W1 计划 | 状态 | 说明 |
|---|---|---|
| D1 脚手架 / monorepo / tokens | ✅ 完成 | Nuxt 4.5.2 + pnpm workspace + `tokens.css` 全量 token |
| D2 上传 + canvas 压缩 | ✅ 完成 | 长边 1024 / JPEG 0.85 / 压缩前后体积逐张展示 |
| D3 识别 + 重试 + zod | ⚠️ 部分 | 链路与 mock 完成；**真实模型调用未验证** |
| D4 表单预填 + 置信度 + 评测标记 | ⚠️ 部分 | 预填/edits/aiCorrect 完成；**刻度尺不达标** |
| D5 SKU 矩阵 | ⚠️ 部分 | 矩阵功能完成；**500 格基准未做** |
| D6 记录持久化 + 耗时埋点 | ⚠️ 部分 | 落盘与三段埋点完成；**记录页未做（仅首页最近 5 条）** |
| D7 打磨 + README | ⏳ 未开始 | 字体未加载、禁止清单未逐条自查 |

---

## 二、已核实的优点（保留，不要重写）

1. **schema 是真正的单一事实源**：`packages/shared/src/schema.ts` 集中枚举 + 导出 `RECOGNIZE_FIELD_NAMES`；`packages/prompts/src/*.ts` 的字段说明从 `RecognizeResultSchema.shape` 生成（`recognize.ts:13`），改 schema 即改 prompt。表单选项、zod 校验、prompt 三处同源，无手写副本。
2. **存储满足新拍的硬约束**：`store.ts:40-50` 临时文件 + `rename` 原子写 + `writeQueue` 串行化；`readRecords` 全量过 schema 校验。
3. **错误处理是完整的**：`api-error.ts` 统一 `{code, message}`，路由层覆盖 E_FORMAT / E_SIZE / E_VALIDATION / E_RATE_LIMIT / E_UPSTREAM / E_RECOGNIZE_INVALID；`vision.ts` 带 repair prompt 重试、`extractFirstJsonObject` 处理模型输出包裹文字的情况（比初稿的纯正则剥离更稳）。
4. **图片安全**：`upload.post.ts:42` 文件头嗅探（非扩展名判断），HEIC 拒收，文件名清洗，`flag: 'wx'` 防覆盖。
5. **设计系统落地度好**：token 全量（含 `--radius-full`）、`*:focus-visible` 焦点环、全局 `prefers-reduced-motion`、虚线/实线吊牌语义、SKU 矩阵 mono + `tabular-nums` + 右对齐、无渐变/毛玻璃，60-30-10 基本守住。
6. **prompts 包设计超出要求**：识别/描述 prompt 分离、`PROMPT_VERSION` 各自独立、`index.ts` 重命名导出避免冲突、README 写清「评测报告必须记录版本号」。

---

## 三、问题清单

### P0 · 阻塞验收（必须改）

**P0-1 置信度刻度尺三重不合格**（`app.vue:551,556,571` + 样式 `:750`）
- 现状：所有字段恒显示 5 格满 `▰▰▰▰▰`，只有颜色 class 区分低置信。
- 违反 PRD 8.2 三条：① 刻度数量必须反映置信度；② 「低于 3 格标 warning 色」需先有格数差异；③ **「CSS 实现，非字符」**——现用字符 `▰▱` + `letter-spacing:-1px` 硬凑。
- 兼违反 8.6#6「禁用颜色作为唯一信息载体」：现在低置信就是纯颜色信号。
- 修法：用 5 个 `<span>` 方块，`filled = clamp(round(confidence*5), 1, 5)`，填充/空块用 border+bg 区分；无独立置信度的字段（seasons/audience/fabric/item_name/tagPrice）沿用 `confidence.overall`；容器加 `aria-label="置信度 n/5"`。

**P0-2 真实模型调用零验证**（环境阻塞，非代码缺陷，但风险最高）
- `vision.ts` 走的是智谱兼容端点 `https://open.bigmodel.cn/api/paas/v4/chat/completions`，请求体用 OpenAI 风格 `{ type:'image_url', image_url:{ url:'data:image/jpeg;base64,...' } }`。**GLM-4V-Flash 是否接受 base64 data URL、字段结构是否一致，全靠猜**——这是目前唯一「可能整体返工」的点。
- 待验：单图 15s 内返回、带吊牌图 tagPrice 读数正确、风景图不崩且 overall<0.5、429/超时的真实表现、token 用量字段（F-9 数据源）。
- 动作：拿到 key 后第一件事就是打这 3 张真实图片，把请求体/响应落盘存证（`results-*.json`），badcase 记进 W1 观察清单。

**P0-3 git 未初始化 + `.env` 已存在**
- 仓库还没有 `.git`，而 `apps/web/.env` 已生成真实密钥文件。`.gitignore` 已加 `.env` / `data/` / `uploads/`，但**首次 commit 前必须实操确认**：`git init` → `git status --short` 核对输出里没有 `.env`、`data/`、`node_modules/`、`.nuxt/`、`.output/`、`.pnpm-store/`。

### P1 · W1 既定任务未完成

**P1-1 记录列表页缺失（D6 核心交付）**
- 现状：无 `app/pages/` 目录，记录只以「首页下方最近 5 条」的形式呈现（`app.vue:628` 硬编码 `slice(0,5)`）。
- 缺口：独立 `/records` 页面；每条的**耗时**（`durationMs` 已落盘但未展示）、成本、AI 修正标记（PRD 记录列表列定义）；行点击展开吊牌卡（复用组件）。
- 对应验收：W1 D6「记录页能看到每件的耗时和 AI 准确标记」——未达标。

**P1-2 500 格性能基准未做（D5 硬性交付）**
- 无极端用例、无渲染耗时数字、README 无基准记录。这是计划里明确要求「不管卡不卡都记下来」的面试素材，别丢。

**P1-3 DS-1 单屏主流程未达标**
- PRD §7 DS-1：上传→识别→表单→提交需在单屏内完成。当前布局左上传 + 右表单纵向堆叠 5 个面板 + 记录区，实际操作需多次滚动。
- 取舍建议：DS-1 与「数据密集 + 可读性」有冲突，若决定放弃单屏，**要在 README 记明取舍**（PRD 是契约，放弃需记录理由），或做成分栏固定 + 右区内滚。

**P1-4 空状态缺「先看示例」入口**（PRD 8.5）
- `app.vue:473-478` 已有引导文案 + 格式说明 ✅，缺示例入口。

### P2 · 记录后补

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| P2-1 | 字体未真正加载 | `tokens.css:14-16` | 声明了 Noto Serif SC / JetBrains Mono，工程无 webfont 引入（无 @nuxt/fonts、无 link）→ 实际落回系统字体，PRD 8.3 的 `font-display: swap` + Fontaine 未落实 |
| P2-2 | 库存 0 未标 `--c-error` | `app.vue:606` | PRD 8.4 明确要求 |
| P2-3 | 顶栏高度漂移 | `app.vue:639` | 56px vs 规范 48px；SKU 单元格 35px vs 32px |
| P2-4 | 错误码表漂移 | `PRD §6` | 代码新增 `E_FILE_NOT_FOUND`、`E_WRITE_FAILED`，PRD 未收录 → 契约反向同步 |
| P2-5 | `description` 初值 = `item_name` | `app.vue:334` | W1 手动阶段可接受；W2 接 SSE 后必须改为「AI 原文 + 人工终值」，并写 `descriptionAi` |
| P2-6 | `costEstimate` 恒 0 / 顶栏无成本计数器 | `app.vue:399` | PRD 8.4 顶栏要求 + F-9；W2 随 usage 一起做 |
| P2-7 | 识别中缺「缩略图边框呼吸」 | PRD 8.5 | 现为按钮 spinner + 文案；规范要求队列缩略图 `opacity 0.6↔1 / 1.2s` |
| P2-8 | 数据目录无清理策略 | `data/` | 免费额度 + 磁盘无上限，W4 前需清理/配额策略（与访问码一起设计） |
| P2-9 | build 与本机 dev server 抢文件锁 | `.nuxt` / `.output` | 审查期实测：dev server 在跑时 `pnpm build` 会在 `clearDir` 阶段失败（Windows 文件占用），重跑即过。**规则：build 前先停 dev；汇报 build 结果时必须附完整日志，不接受只报「通过」** |

---

## 四、下一阶段目标（到 W1 结束，10/12）

1. **D3 收尾（最高优先）**：拿到 key → 真图三连测（清晰服装 / 带吊牌 / 非服装）→ 落盘存证 + badcase 记录 → 确认 GLM-4V 请求体与 usage 字段。
2. **D4 收尾**：刻度尺改 CSS 分格（P0-1）；确认 seasons/audience 等 fallback 到 `overall` 是可接受口径，写进 README。
3. **D5 收尾**：造 500 格用例 + 记录渲染耗时；若卡顿，优先方案是行虚拟化或分块渲染（输入已非受控，先测再优化，别提前过度设计）。
4. **D6 主体**：`/records` 页面（耗时、成本、AI 修正标记、行展开吊牌卡）+ 页面间导航；`data/records.json` 已支持。
5. **D7 打磨**：字体加载（需同意新增 `@nuxt/fonts`）、库存 0 标红、空状态示例入口、8.6 禁止清单逐条自查、README 补 ≥5 条设计取舍。
6. **横切**：PRD 错误码表回填两个新码；`git init` + 首次 commit（先核 `.env` 未入列）。

---

## 五、给 Codex 的指令（可直接粘贴）

```
按此顺序执行，每完成一项跑 pnpm typecheck && pnpm build，并在汇报里给出实际输出。

【任务 1 · P0 修复】置信度刻度尺按 PRD 8.2 重做
- 文件：apps/web/app/app.vue（字段卡部分 + 样式）
- 要求：5 格刻度用 CSS 方块实现（禁止用 ▰▱ 等字符、禁止 letter-spacing 硬凑）；填充格数 = clamp(round(confidence*5), 1, 5)；
  少于 3 格用 --c-warn-ink；无独立置信度的字段（seasons/audience/fabric/item_name/tagPrice）用 confidence.overall；
  容器加 aria-label="置信度 n/5"。替换现有 confidence-ticks / ticks--low 实现，不要保留两套。
- 依据：PRD 8.2 + 8.6 第 6 条「禁止颜色作为唯一信息载体」。

【任务 2 · P1 新建记录页】
- 新建 apps/web/app/pages/index.vue（现 app.vue 内容迁入）与 apps/web/app/pages/records.vue；app.vue 只留 <NuxtPage />。
- records.vue 列表列：缩略图、商品名（品类 · 颜色）、SKU 数、耗时（durationMs：uploadStart→submittedAt，格式 1m 42s，mono）、成本（costEstimate，¥0.000）、人工修正（edits.length → "n 项已改"/"无修改"）。
- 行点击展开吊牌卡（实线边框，已确认为人工终值），显示终值字段与 edits 的 from → to 流水（mono）。
- 不要求分页、搜索、导出（PRD 记录列表明确禁批量/导出）。
- 顶部导航：录入工作台 / 记录列表。

【任务 3 · P1 性能基准】
- 造 1 色 × 500 码（或 20 色 × 25 码）的极端用例，实测矩阵渲染与输入流畅度，把设备、耗时、是否掉帧写进 README「性能基准」小节；卡就如实记录，别改数据。

【任务 4 · P2 小修】
- 库存为 0 的单元格文字用 --c-error（PRD 8.4）。
- 空状态补「先看示例」入口（点击填入一段示例商品资料，不请求模型）。
- 识别中状态：上传队列对应缩略图加 opacity 0.6↔1 / 1.2s 呼吸（reduced-motion 下静态）。
- description 初值改为空字符串，标签注明「W1 手动填写」；不要再用 item_name 冒充描述。

【任务 5 · 文档同步】
- 把 E_FILE_NOT_FOUND、E_WRITE_FAILED 回填 PRD 第 6 节错误码表（含触发条件、系统处理、用户提示），并在文档信息表登记为 V1.4。
- README 记录三条取舍：① 为什么 W1 用 JSON + 原子写；② 单屏流程（DS-1）的取舍结论；③ 无独立置信度的字段为何 fallback 到 overall。

【已预批准的新增依赖】@nuxt/fonts（D7 用，加载 Noto Serif SC + JetBrains Mono，font-display: swap）。这是本轮唯一预批准的新依赖，其他照 AGENTS.md 先问。
- 验证方式：build 产物里能看到字体文件与 @font-face；体感标题变宋体、数据列变等宽。

【环境任务（我本人执行，你不用做）】git init + 首次 commit 前先 git status --short 核对 .env / data/ / uploads/ 不在待提交列表里。
```

---

## 六、验收清单（本轮改完自查）

- [ ] 刻度尺：低置信字段与高置信字段的格数肉眼可辨，且无字符实现残留
- [ ] `/records` 页可见每条记录的耗时与修正项数
- [ ] README 有 500 格渲染基准数字
- [ ] `pnpm typecheck` + `pnpm build` 双绿
- [ ] PRD 错误码表含两个新码，版本号已更新
- [ ] 真实模型三连测有落盘存证（有 key 后立即补）
