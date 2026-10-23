const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

export const apiBaseUrl = (
  configuredBaseUrl || "http://localhost:3000"
).replace(/\/+$/, "");

export type ApiEnvironment = "local" | "lan" | "online";

export function getApiEnvironment(url: string): ApiEnvironment {
  const host = /^https?:\/\/([^/:]+)/i.exec(url)?.[1]?.toLowerCase() ?? "";
  if (host === "localhost" || host === "127.0.0.1") return "local";
  if (
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return "lan";
  }
  return "online";
}
