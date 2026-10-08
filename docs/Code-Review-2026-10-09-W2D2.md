# Code Review — W2-2 流式描述生成（提交 7354eb3）

- 日期：2026-10-09
- 对象：`feat: 增加流式商品描述生成`（10 文件，+604/−89）
- Reviewer：栈师（AI）
- 结论：**通过**。核心目标全部达成，实测验证无 P0/P1 问题，3 条 P2 记录在案。

## 一、改动面

| 文件 | 内容 |
|---|---|
| `apps/web/server/api/records/[id]/describe.post.ts` | 新增 SSE 接口，mock 流 + nitro 原生 res.write，无第三方库 |
| `apps/web/server/api/records/[id]/describe.post.test.ts` | 3 用例：流完整性 / 404 / 401 |
| `apps/web/app/pages/records.vue` | 「生成描述」按钮、SSE 逐字渲染、打字光标、中断兜底 |
| `packages/shared/src/schema.ts` | 新增 `DescribeResultSchema`（60–100 字）与 `DescriptionSourceSchema`（pick 自识别结果） |
| `packages/prompts/src/describe.ts` | prompt 改为 schema 驱动（从 DescriptionSource/DescribeResult shape 现场生成） |
| `apps/web/server/utils/access-code.ts` | 抽出 `assertAccessCode`（timingSafeEqual 保持不变）供中间件复用 |
| `apps/web/server/utils/store.ts` | 新增 `saveGeneratedDescription`（UPDATE description_ai） |
| `docs/PRD…v1.0.md`、`README.md` | 本次 Codex **主动同步了文档**（前两次遗漏的问题已改正） |

## 二、实测验证（非仅看代码）

环境：本机 dev server（`NUXT_VISION_MOCK=1` + `NUXT_ACCESS_CODE=test123`），向 SQLite 造一条完整记录后 curl 实测：

| # | 用例 | 结果 |
|---|---|---|
| 1 | 无访问码 POST describe | ✅ 401 `E_ACCESS_CODE_REQUIRED`，`data.code` 结构正确 |
| 2 | 不存在 ID + 正确访问码 | ✅ 404 `E_RECORD_NOT_FOUND` |
| 3 | **流式时序**（`curl -N` 逐行打时间戳） | ✅ **真·流式**：10 个 chunk 以 ~130ms 间隔分批到达（总耗时 ~2.5s），不是一次拼完再假分段 |
| 4 | mock=0 路径 | ✅ 代码路径返回 503 `E_DESCRIPTION_UNAVAILABLE`，README 口径一致 |
| 5 | 描述落库 | ✅ `description_ai` 写入 97 字全文 |
| 6 | `pnpm test` | ✅ 7/7 通过（store 4 + describe 3） |
| 7 | `pnpm typecheck` | ✅ 无错误 |

## 三、P2 记录（不阻断，后续处理）

1. **P2-1 先落库后推流**：`saveGeneratedDescription` 在 `writeDescriptionStream` 之前执行。用户中途断开时，DB 已存全文、前端只显示半截并提示"请重新生成"。重新生成会覆盖，数据无损——可接受的取舍，但行为上略有割裂。
2. **P2-2 result 事件未消费**：SSE 尾部发 `event: result`（description 置信度 0.88），前端解析层直接忽略。识别结果有置信度刻度尺，描述置信度没有 UI，设计系统层面留了个缺口。
3. **P2-3 readRecords 全表 parse（W2 遗留，非本提交引入）**：`describe` 接口为找一条记录把**所有**记录全部 zod parse。实测踩到：手工造的一条缺 SKU 的脏记录会让**所有** API 500（一条脏数据炸全家）。数据量小无实际影响，后续可改单行 `SELECT … WHERE id=?`。

## 四、给 Codex 的肯定

- 这次汇报可信：commit 完整走钩子，测试真实存在且通过，文档（PRD/README）主动同步——前两次"零落地"的问题没有再犯。
- prompt 依然坚持 schema 驱动（新增 schema 也能现场生成字段说明），架构一致性保持住了。

## 五、下一步

1. 用户执行 `git push origin main`（本地领先远端 1 个提交：7354eb3）。
2. W2-3 评测报告（纯文档任务）。
3. 之后只剩：Demo GIF、真模型三连测（继续挂起）。
