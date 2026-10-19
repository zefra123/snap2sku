import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDirectory = join(root, "apps", "web");
const uploadDirectory = join(root, "data", "uploads");
const outputFile = join(root, "results-mock-regress.txt");
const lines = [];
let stubServer;
let appProcess;
let uploadPath;

function log(value) {
  lines.push(value);
  process.stdout.write(`${value}\n`);
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      output += chunk;
      if (!options.captureOnly) process.stdout.write(chunk);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      output += chunk;
      if (!options.captureOnly) process.stderr.write(chunk);
    });
    child.once("error", rejectRun);
    child.once("close", (code, signal) => {
      if (code !== 0) {
        rejectRun(new Error(`${command} exited ${code ?? signal}\n${output}`));
        return;
      }
      resolveRun(output);
    });
  });
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法分配端口");
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return address.port;
}

async function waitFor(url, child, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Nuxt production server exited early:\n${output()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // 服务仍在启动。
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Nuxt production server did not become ready:\n${output()}`);
}

try {
  log("[1/4] Build with NUXT_VISION_MOCK=1");
  const buildEnv = { ...process.env, NUXT_VISION_MOCK: "1" };
  await run("pnpm", ["--filter", "@snap2sku/web", "build"], {
    cwd: root,
    env: buildEnv,
  });
  log("PASS build exitCode=0");

  const stubPort = await availablePort();
  let stubRequests = 0;
  const recognized = {
    category: "上衣",
    colors: [{ name: "黑色", hex: "#000000" }],
    style: "休闲",
    seasons: ["夏"],
    audience: "女",
    fabric: "棉",
    tagPrice: 399,
    item_name: "黑色休闲短袖上衣",
    confidence: { category: 0.9, colors: 0.9, style: 0.9, overall: 0.9 },
  };
  stubServer = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v4/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    stubRequests += 1;
    for await (const _chunk of request) {
      // 读完请求体，避免客户端写入未完成。
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(recognized) } }],
        usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 },
      }),
    );
  });
  await new Promise((resolveListen, reject) => {
    stubServer.once("error", reject);
    stubServer.listen(stubPort, "127.0.0.1", resolveListen);
  });

  const appPort = await availablePort();
  const fileId = randomUUID();
  await mkdir(uploadDirectory, { recursive: true });
  uploadPath = join(uploadDirectory, `${fileId}.jpg`);
  await writeFile(uploadPath, Buffer.from("regression-image"));
  const serverEnv = {
    ...process.env,
    NODE_ENV: "production",
    NUXT_VISION_MOCK: "0",
    NUXT_VISION_API_KEY: "dummy-regression-key",
    NUXT_VISION_BASE_URL: `http://127.0.0.1:${stubPort}/v4/chat/completions`,
    NUXT_VISION_INPUT_PRICE_PER_MILLION: "2",
    NUXT_VISION_OUTPUT_PRICE_PER_MILLION: "8",
    NUXT_ACCESS_CODE: "regression-access-code",
    NUXT_UPLOAD_SIGNING_SECRET: randomBytes(32).toString("base64url"),
    NITRO_HOST: "127.0.0.1",
    NITRO_PORT: String(appPort),
    PORT: String(appPort),
  };
  let appOutput = "";
  appProcess = spawn(process.execPath, [".output/server/index.mjs"], {
    cwd: webDirectory,
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  appProcess.stdout.setEncoding("utf8").on("data", (chunk) => {
    appOutput += chunk;
  });
  appProcess.stderr.setEncoding("utf8").on("data", (chunk) => {
    appOutput += chunk;
  });

  log("[2/4] Start built server with NUXT_VISION_MOCK=0");
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const infoResponse = await waitFor(`${baseUrl}/api/runtime-info`, appProcess, () => appOutput);
  const info = await infoResponse.json();
  if (info.mock !== false || info.priceConfigured !== true) {
    throw new Error(`runtime-info mismatch: ${JSON.stringify(info)}`);
  }

  log("[3/4] Call recognize API through local model stub");
  const recognizeResponse = await fetch(`${baseUrl}/api/recognize`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-access-code": "regression-access-code",
    },
    body: JSON.stringify({ fileId }),
  });
  const result = await recognizeResponse.json();
  if (!recognizeResponse.ok) {
    throw new Error(`recognize failed (${recognizeResponse.status}): ${JSON.stringify(result)}`);
  }
  if (stubRequests < 1) throw new Error("model stub was not called");
  if (JSON.stringify(result.result) !== JSON.stringify(recognized)) {
    throw new Error(`recognize result differs from stub: ${JSON.stringify(result)}`);
  }
  if (result.costEstimate !== 0.0028) {
    throw new Error(`unexpected costEstimate: ${result.costEstimate}`);
  }

  log(`PASS runtime-info.mock=${info.mock}`);
  log(`PASS stubRequests=${stubRequests}`);
  log(`PASS result matches stub`);
  log(`PASS costEstimate=${result.costEstimate}`);
} catch (error) {
  log(`FAIL ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  appProcess?.kill();
  if (stubServer?.listening) {
    await new Promise((resolveClose) => stubServer.close(resolveClose));
  }
  if (uploadPath) await rm(uploadPath, { force: true });
  await writeFile(outputFile, `${lines.join("\n")}\n`);
}
