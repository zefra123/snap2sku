import { defineEventHandler } from "h3";

// 公开探针只返回健康状态；待对账笔数改从需访问码的 /api/runtime-info 读取。
export default defineEventHandler(() => ({ status: "ok" as const }));
