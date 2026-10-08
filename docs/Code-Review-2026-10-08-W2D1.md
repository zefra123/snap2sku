# Code Review · 提交 dbc61d7（W2 存储与访问码门禁）

> 日期：2026-10-08 ｜ 审查方式：逐文件读源码 + 本机实跑（typecheck / vitest / build / 生产产物 / 门禁端到端）
> 审查对象：`dbc61d7 feat: 落地 W2 存储与访问码门禁`（本地未推送，remote 仍停在 `ae5aa55`）
> 基准：`docs/PRD-AI商品录入助手-v1.0.md`、`docs/总体技术规划.md` v1.1、`AGENTS.md`

## 一、结论

**代码质量高，三项任务全部真实落地，未发现 P0。** 主要问题集中在**文档半同步**与少量打磨项。

## 二、验证记录（均为实跑，非采信汇报）

| 项                     | 命令                            | 结果                                                                                 |
| ---------------------- | ------------------------------- | ------------------------------------------------------------------------------------ |
| 类型检查               | `pnpm typecheck`                | ✅ exit 0                                                                            |
| 单元测试               | `pnpm test`                     | ✅ 4/4 通过（233ms）                                                                 |
| 生产构建               | `pnpm build`                    | ✅ exit 0，Build complete                                                            |
| 生产产物运行           | `node .output/server/index.mjs` | ✅ 原生模块正常加载，`GET /api/records` 返回 200                                     |
| 数据库完整性           | 直连 sqlite 查询                | ✅ 表 `records`/`skus` 建立正确；0 记录（因旧 JSON 本身为 `[]`，与 `.bak` 内容一致） |
| 门禁：无码写接口       | `POST /api/records`             | ✅ 401 `E_ACCESS_CODE_REQUIRED`                                                      |
| 门禁：错码             | `POST /api/records` + 错误码    | ✅ 401                                                                               |
| 门禁：正确码           | `POST /api/records` + 正确码    | ✅ 放行，进入业务校验（400 E_VALIDATION）                                            |
| 门禁：读接口放行       | `GET /api/records` 无码         | ✅ 200                                                                               |
| 门禁：upload/recognize | 无码 POST                       | ✅ 401 / 401                                                                         |

## 三、实现亮点

1. **store.ts 门面接口签名未变**（`readRecords` / `appendRecord` / `findUploadPath`），底层 JSON → SQLite 的替换对业务层完全透明——架构约束执行到位。
2. **迁移逻辑安全**：`.bak` 已存在时主动抛错中止，避免覆盖旧备份；迁移失败回滚并关闭连接、清空内部状态（不会留下半初始化单例）。
3. **WAL + `foreign_keys = ON`** 双 pragma 到位，级联删除有单测覆盖。
4. **门禁实现正确**：`timingSafeEqual` 前先比长度（顺序正确，否则会抛异常）；未配置访问码时自动降级为放行并带 `X-Access-Code-Mode: disabled` 响应头，本地开发零摩擦。
5. **vision.ts 端点拼接健壮**：`baseUrl` 带不带 `/chat/completions` 都能正确归一——之前踩过的配置分歧被永久消除。
6. 测试用 `mkdtempSync` 临时目录 + `afterEach` 清理，不污染真实 `data/`。

## 四、问题清单

### P1（建议本轮修）

| #    | 问题                          | 位置                                        | 说明                                                                                                                                                                                                   |
| ---- | ----------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1-1 | PRD 标题与版本行不一致        | `docs/PRD-*.md:1` vs `:9`                   | 标题仍是 **V1.5**，版本行已写 **V1.6**                                                                                                                                                                 |
| P1-2 | PRD 存储口径半同步            | PRD `:70` `:112` `:152` `:288`              | §5 流程第 11 步、§5.3、`E_WRITE_FAILED` 描述仍写 `data/records.json`；Next Steps 仍写「records.json → SQLite 切换时机（建议 W2 末）」——已完成，应改为已落地                                            |
| P1-3 | `.env.example` 重复且内容漂移 | 根 `.env.example` + `apps/web/.env.example` | 两份同时存在且不一致：根版有 `NUXT_ACCESS_CODE`、`MOCK=1`、带 `/chat/completions`；app 版无访问码键、`MOCK=0`、不带路径。**Nuxt 实际只读 `apps/web/.env`**，根版会误导。且 app 版缺 `NUXT_ACCESS_CODE` |

### P2（可择机）

| #    | 问题                               | 位置                                  | 建议                                                                                                                                                                                                                  |
| ---- | ---------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-1 | 受保护路由写死 Set                 | `server/middleware/access-code.ts:5`  | 新增写接口容易漏保护。建议改为规则判断（如 `/api/**` 且 method ≠ GET 一律保护），或加单测锁住清单                                                                                                                     |
| P2-2 | `better-sqlite3.d.ts` 手写最小声明 | `apps/web/shared/better-sqlite3.d.ts` | 类型很薄（`pragma` 返回 `unknown`、无泛型 → 查询结果只能 `as` 断言）。若将来安装 `@types/better-sqlite3`，本文件会与之冲突（ambient 声明优先）。建议加注释写明「刻意不引官方类型，如需完整类型请删本文件改装 @types」 |
| P2-3 | 并发测试名不副实                   | `store.test.ts:75`                    | better-sqlite3 是同步 API + Node 单线程，`Promise.all` 不会真并发。建议改名「连续追加 40 条不丢数据」，或补说明，避免评测时被追问                                                                                     |
| P2-4 | 规划文档未升版                     | `docs/总体技术规划.md:3`              | 内容已按 W2 提前落地更新，版本号仍 v1.1                                                                                                                                                                               |
| P2-5 | 构建产物体积                       | —                                     | 总 20.1 MB（含 better-sqlite3 原生二进制），W4 部署时注意；`node_modules` 依赖打包策略可再评估                                                                                                                        |
| P2-6 | 备份 API 未实现                    | —                                     | 规划要求「备份必须走 `.backup()`」，目前没有备份入口——属未实现而非违反，W4 前补                                                                                                                                       |

### 补充观察

- `data/uploads` 有 11 张图片但数据库 0 条记录：说明此前手工测试只上传未提交。迁移路径的真实数据验证只能靠单测（已覆盖，迁移保真断言完整），**不影响结论**。
- 旧 JSON 为 `[]`，迁移走的是「空源」分支；已有单测用带数据 fixture 覆盖正常分支，可接受。

## 五、给 Codex 的指令

```
提交 dbc61d7 已复审（typecheck / vitest / build / 生产产物 / 门禁端到端 全通过），
代码无需返工。请完成以下文档同步，然后提交：

【任务 1 · P1】PRD 存储口径全量同步（docs/PRD-AI商品录入助手-v1.0.md）
- 第 1 行标题 V1.5 → V1.6（与版本行一致）。
- §5 流程第 11 步、§5.3、错误码表 E_WRITE_FAILED 行的 records.json 描述，
  统一改为 data/records.sqlite（SQLite 事务写入）。
- Next Steps 里「records.json → SQLite 切换时机」条目：改为已完成，
  注明「W2 首日提前落地，由 store.ts 启动迁移，旧文件保留为 records.json.bak」。

【任务 2 · P1】消除 .env.example 重复
- 保留 apps/web/.env.example（Nuxt 实际读取位置），在其中补 NUXT_ACCESS_CODE 键
  （附注释：留空 = 本地开发放行；部署时必须设置）。
- 删除仓库根目录的 .env.example（会误导，且与 app 版漂移）。
- README 若引用了 env 模板路径，一并校正。

【任务 3 · P2 打磨，可同批】
- access-code.ts：把写死路由 Set 改为规则保护（/api/** 且 method !== GET 一律校验），
  或保留白名单但加一条单测断言「所有 server/api 下的 POST 路由都在保护清单里」。
- store.test.ts：「并发追加」用例改名或补注释，说明 better-sqlite3 同步 API 下
  该用例验证的是连续写入不丢数据，而非真并发。
- better-sqlite3.d.ts 顶部加一行注释，说明为何不引官方类型、何时该删。
- 总体技术规划.md 版本号升 v1.2。

完成后提交，信息用 type: 描述 格式。
```

## 六、待办（用户侧）

- [ ] `git push origin main`（当前本地领先远端 1 个提交 `dbc61d7`）
- [ ] 本报告 `docs/Code-Review-2026-10-08-W2D1.md` 未被忽略，可一并提交
