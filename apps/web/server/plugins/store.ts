import {
  initializeStore,
  modelSpendSummary,
  probeDataDirectory,
  recordCount,
  windowsRootedPathWarning,
  type DataDirectoryProbe,
} from "../utils/store";
import { assertProductionDataDirectoryExists } from "../utils/access-code";

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig();
  const isProduction = process.env.NODE_ENV === "production";
  const probe = probeDataDirectory(config.dataDir);

  // 生产环境必须先探测再初始化：目录不存在时直接拒绝启动，
  // 不能 mkdir 出一份空账本让熔断静默失效。
  assertProductionDataDirectoryExists(
    isProduction,
    probe.directory,
    probe.exists,
  );

  const pathWarning = windowsRootedPathWarning(
    process.platform,
    String(config.dataDir ?? ""),
    probe.directory,
  );
  if (pathWarning) console.warn(`[store] ${pathWarning}`);

  initializeStore(probe.directory);
  console.log(`[store] 数据目录: ${probe.directory}${describeLedger(probe)}`);
});

function describeLedger(probe: DataDirectoryProbe): string {
  if (!probe.databaseExists) {
    const reason = probe.exists
      ? "该目录下没有 records.sqlite"
      : "目录此前不存在";
    return (
      `｜⚠ 新建空账本（${reason}），累计费用从 ¥0 起算；` +
      "若不是首次部署，立即检查 NUXT_DATA_DIR 是否指错"
    );
  }

  const summary = modelSpendSummary();
  const pending =
    summary.pendingReconcile > 0
      ? `，待对账 ${summary.pendingReconcile} 笔（需人工核对后释放）`
      : "，待对账 0 笔";
  return (
    `｜沿用已有账本：记录 ${recordCount()} 条，` +
    `累计已花费 ¥${summary.spentCny.toFixed(2)}，` +
    `预占 ¥${summary.reservedCny.toFixed(2)}${pending}`
  );
}
