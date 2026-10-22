import { timingSafeEqual } from "node:crypto";
import { createError } from "h3";

export function assertAccessCode(expected: string, supplied: string): void {
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  )
    return;

  throwAccessCodeRequired();
}

export function throwAccessCodeRequired(): never {
  throw createError({
    statusCode: 401,
    statusMessage: "E_ACCESS_CODE_REQUIRED: 访问码缺失或不正确",
    data: { code: "E_ACCESS_CODE_REQUIRED", message: "访问码缺失或不正确" },
  });
}

export function assertProductionAccessCodeConfigured(
  isProduction: boolean,
  configuredCode: string,
): void {
  if (isProduction && !configuredCode.trim()) {
    throw new Error("必须设置 NUXT_ACCESS_CODE，否则拒绝启动");
  }
}

export function assertProductionUploadSigningSecretConfigured(
  isProduction: boolean,
  secret: string,
): void {
  if (!isProduction) return;
  const keyBytes = Buffer.from(secret, "base64url");
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(secret) ||
    keyBytes.byteLength !== 32 ||
    keyBytes.toString("base64url") !== secret
  ) {
    throw new Error(
      "必须设置至少 32 字节随机值的 NUXT_UPLOAD_SIGNING_SECRET，否则拒绝启动",
    );
  }
}

export function assertProductionDataDirectoryConfigured(
  isProduction: boolean,
  dataDir: unknown,
): void {
  if (isProduction && !String(dataDir ?? "").trim()) {
    throw new Error(
      "必须设置 NUXT_DATA_DIR，否则拒绝启动（避免额度账本随工作目录漂移）",
    );
  }
}

/**
 * 生产环境要求 NUXT_DATA_DIR 指向的目录已存在。
 * 自动创建会把「路径写错」变成「静默启用一份空账本」：
 * 服务照常启动、容器健康检查 200、前端显示累计费用 ¥0，¥200 熔断彻底失效且零报警。
 * 目录交给部署脚本 mkdir -p 创建，应用只负责使用。
 */
export function assertProductionDataDirectoryExists(
  isProduction: boolean,
  directory: string,
  directoryExists: boolean,
): void {
  if (!isProduction || directoryExists) return;
  throw new Error(
    `数据目录 ${directory} 不存在，拒绝启动。` +
      "生产环境不会自动创建数据目录：请先创建目录并挂载持久化磁盘，" +
      "再检查 NUXT_DATA_DIR 是否写错（Windows 请用 C:/... 而不是 Git Bash 的 /c/...）",
  );
}
