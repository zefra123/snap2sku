const ACCESS_CODE_STORAGE_KEY = "snap2sku-access-code";
export const ACCESS_CODE_REQUIRED_EVENT = "snap2sku:access-code-required";

type ApiFetchOptions = NonNullable<Parameters<typeof $fetch>[1]>;

let accessCodePromptOpen = false;

export function getAccessCode(): string {
  try {
    return typeof localStorage === "undefined"
      ? ""
      : (localStorage.getItem(ACCESS_CODE_STORAGE_KEY) ?? "");
  } catch {
    return "";
  }
}

export function setAccessCode(code: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    const trimmedCode = code.trim();
    if (trimmedCode) localStorage.setItem(ACCESS_CODE_STORAGE_KEY, trimmedCode);
    else localStorage.removeItem(ACCESS_CODE_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

export function acknowledgeAccessCodeSaved(): void {
  accessCodePromptOpen = false;
}

export async function apiFetch<T>(
  path: string,
  options?: ApiFetchOptions,
): Promise<T> {
  const headers = withAccessCode(options?.headers);
  try {
    const response: unknown = await $fetch<T>(path, { ...options, headers });
    return response as T;
  } catch (error) {
    if (findErrorCode(error) === "E_ACCESS_CODE_REQUIRED") {
      clearInvalidAccessCode();
    }
    throw error;
  }
}

export async function apiStream(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    headers: withAccessCode(init.headers),
  });
  if (response.status === 401) {
    const code = await response
      .clone()
      .json()
      .then(findErrorCode)
      .catch(() => undefined);
    if (code === "E_ACCESS_CODE_REQUIRED") clearInvalidAccessCode();
  }
  return response;
}

function withAccessCode(headersInit?: HeadersInit): Headers {
  const headers = new Headers(headersInit);
  const code = getAccessCode();
  if (code) headers.set("x-access-code", code);
  return headers;
}

function clearInvalidAccessCode(): void {
  setAccessCode("");
  if (accessCodePromptOpen || typeof window === "undefined") return;
  accessCodePromptOpen = true;
  window.dispatchEvent(new Event(ACCESS_CODE_REQUIRED_EVENT));
}

function findErrorCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (record.code === "E_ACCESS_CODE_REQUIRED") return record.code;
  return (
    findErrorCode(record.data) ??
    findErrorCode(record._data) ??
    findErrorCode(record.response)
  );
}
