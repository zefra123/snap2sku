export function failApi(statusCode: number, code: string, message: string): never {
  throw createError({ statusCode, statusMessage: `${code}: ${message}`, data: { code, message } })
}
