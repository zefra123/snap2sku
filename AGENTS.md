# snap2sku · Agent 工作约束

> 本文件只写**约束**：不许做什么、必须怎么做。不写目标、不写进度、不写计划。
> 做什么/什么时候做 → `docs/总体技术规划.md`（架构与演进）+ `docs/W1-执行计划.md`（本周任务）。
> 本文件是硬约束。与代码现状、与任何"顺手优化"冲突时，以本文件为准。拍板了新决策回来改这里。

---

## 1. 范围约束

- 当前阶段（W1，10/6–10/12）**禁止**：uniapp 小程序端、登录/多租户、ERP 对接、模型微调、原生 App、支付、正式部署。
- 禁止为"结构更完整"提前建空目录、抽未使用的抽象、写没人调用的代码。

## 2. 技术栈（锁定，改主版本先问）

| 用途 | 选择 |
|---|---|
| 包管理 | pnpm 11.19.0 + workspace（禁用 npm/yarn，防第二份 lockfile） |
| Web 框架 | Nuxt 4.5.2 + TypeScript（strict，禁 `any` 兜底） |
| 校验 | zod，schema 单一事实源 |
| 多模态 | GLM-4V-Flash，走服务端适配器 |
| 状态 | Nuxt `useState` |
| 存储 | 本地 JSON 文件（`data/records.json`） |
| 移动端 | uniapp——W3 前不建任何文件 |

不引入第二套前端框架（React/Next 一律不加）。

## 3. 仓库结构 & Nuxt 4 目录约定

```
snap2sku/
├─ apps/web/                      # @snap2sku/web
│  ├─ app/                        # ← 前端源码全在这里（Nuxt 4 的 srcDir）
│  │  ├─ app.vue
│  │  ├─ pages/  components/  composables/  assets/
│  ├─ server/                     # ← 服务端在 apps/web 根下，不在 app/ 里
│  │  └─ api/                     #    /api/* 路由
│  ├─ public/                     # ← 也在根下
│  ├─ nuxt.config.ts
│  ├─ tsconfig.json               # project references → .nuxt/tsconfig.*.json
│  └─ package.json
├─ packages/shared/               # zod schema + 类型（唯一事实源）
├─ packages/prompts/              # 识别 prompt，版本化
├─ pnpm-workspace.yaml            # workspace + 本机依赖配置（见 §7）
└─ package.json
```

- 别名 `~/`、`@/` 都指向 `apps/web/app/`（实测确认）。
- **容易踩**：在 `apps/web/` 根下建 `pages/`、`components/`、`assets/` 不报错但**不生效**，必须放 `app/` 下。
- `apps/web/server/**` 不参与前端 tsconfig；跨前后端共享类型只能走 `packages/shared`。
- Nuxt 4 自带的 `apps/web/shared/`（`#shared`）与本项目 `packages/shared` **是两回事**，共享 schema 一律放后者。

## 4. 硬约束（不可协商）

1. **schema 唯一事实源** = `packages/shared` 的 zod schema。表单下拉项、枚举、校验、prompt 字段说明全部由它生成/引用；前端和 prompt 里**禁止手写第二份字段列表**。
2. **设计 token 唯一来源** = `apps/web/app/assets/css/tokens.css`；组件里禁止写死颜色、字号、圆角。
3. **密钥只在服务端**：API key 走 `.env` + Nuxt `runtimeConfig`，只在 `server/**` 读取，**绝不出现在前端代码或 `public/`**。
4. **Stitch 导出的 HTML 只作视觉参考**：不复制其 Tailwind CDN 写法，不整份搬进工程。
5. **模型调用一律走服务端适配器**（`server/utils/vision.ts`）：业务代码不直接 import SDK，换模型只改适配器一处。
6. **当前存储 = 本地 JSON**（`data/records.json`），数据访问必须走 `server/utils/store.ts` 门面接口（架构见总体技术规划 §5）。
7. **错误码统一**（以 `docs/PRD-AI商品录入助手-v1.0.md` 第 6 节错误码表为准，如 `E_RATE_LIMIT`）：上传失败、识别超时/限流、zod 校验不通过都要有明确 UI 状态和错误码，不允许只有 happy path。
8. **AI 结果保留 confidence**：< 0.7 的字段在 UI 上标黄要求人工确认；用户修改要记录「AI 对/错」标记，评测数据从第一天开始攒。

## 5. 未定项：禁止提前装、提前实现

| 未定项 | 禁止 |
|---|---|
| 样式方案（Tailwind v4 vs 手写 CSS） | 装 Tailwind / 任何 CSS 框架 |
| Pinia | 装 Pinia，状态用 `useState` |
| 数据库 | 装 better-sqlite3 / prisma / drizzle |
| 部署平台 | 加 vercel.json / Dockerfile / CI 配置 |

规则：新增任何**运行时**依赖前先问。用某个包的 API 前先读它自带的类型定义，不凭记忆写配置。

## 6. 验收命令（改完必须跑）

```bash
pnpm dev        # 起 apps/web dev server
pnpm build      # 必须通过；build 过不了 = 没做完
pnpm typecheck  # vue-tsc 全量类型检查，必须 0 错误
```

- 每次改完一批代码：`pnpm typecheck` + `pnpm build`；关键路径用 `pnpm dev` 点一遍。
- 不提交 `node_modules/`、`.nuxt/`、`.output/`、`.pnpm-store/`（已在 `.gitignore`）。

## 7. 本机环境约束（Windows，实测）

- `pnpm-workspace.yaml` 里的 `nodeLinker: hoisted` 是**本机绕行**：pnpm 默认 isolated 链接在本机创建符号链接失败/生成空占位目录。**别删**。
- `storeDir` 指向工程内 `.pnpm-store`（全局缓存在只读盘），已 gitignore。
- **pnpm 11 的配置写 `pnpm-workspace.yaml`，不写 `.npmrc`**（实测读不到）。
- 依赖装不干净时用 `CI=true pnpm install` 重建（无 TTY 时 pnpm 拒绝自动清空 node_modules）。
- 脚本里起 dev server 记得 `process.exit(0)`，否则进程不退出。

## 8. 代码约定

- TypeScript strict；`@ts-ignore` 必须旁边写明原因。
- 命名：组件 PascalCase、composable `useXxx`、server 路由小写短横线。
- 标识符英文、注释和提交信息中文；注释只写"为什么"。
- 字段命名与 `packages/shared` 的 schema 一致，不另起别名。
- **SKU 价格字段名固定**：`tagPrice`（吊牌价，可预填 AI 建议值）/ `wholesalePrice`（批发单价）。**禁止出现 `listPrice` / `salePrice`**（PRD V1.3 已废弃的旧命名，DB 列名对应 tag_price / wholesale_price）。识别结果的 AI 建议吊牌价字段为 `tagPrice: number | null`，吊牌不可见必须 null，禁止猜。

## 9. 交付前自查

- [ ] 装了 §5 的未定项吗？
- [ ] 手写了第二份枚举/字段列表吗？
- [ ] key 或任何密钥值进前端 / `public/` 了吗？
- [ ] `pnpm typecheck` 和 `pnpm build` 都过了吗？
- [ ] 有没有"看起来一样、其实是另一套"的重复（schema / 字段文案 / 错误码）？

## 10. 参考文档（都在仓库内）

| 文档 | 职责 |
|---|---|
| `docs/总体技术规划.md` | 架构：前后端结构、数据库演进、双端、四周路线 |
| `docs/PRD-AI商品录入助手-v1.0.md` | 数据模型 / API 契约 / 错误码表 / 验收标准（契约冲突以它为准） |
| `docs/W1-执行计划.md` | 本周每日任务与验收 |
| `docs/技术选型决策与待确认清单.md` | 选型依据 |
| `docs/识别prompt与schema-初稿.md` | prompt 与 schema 初稿 |

## 11. 待拍板（拍板后回填本文件 + 总体技术规划）

已拍板：**上线访问码门禁**（W4 部署时实现，方案见总体技术规划 §8，产品侧已记 PRD V1.2）——在它实现之前，W1-W3 期间禁止提前做鉴权中间件。

- [ ] 样式：Tailwind v4（`@theme` 吃 token） vs 手写 CSS 变量
- [ ] Pinia 是否需要
- [ ] 数据库切换时机（默认 W2 末，跟批量功能一起）
- [ ] GLM-4V-Flash 免费额度与并发数（决定 `E_RATE_LIMIT` 阈值）
- [ ] git 仓库未建（首个 commit 把 `docs/` 一起推上去）
