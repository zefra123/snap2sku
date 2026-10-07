import { ProductRecordSchema } from '@scope/shared/schema'
import { failApi } from '../utils/api-error'
import { appendRecord } from '../utils/store'

export default defineEventHandler(async (event) => {
  const input: unknown = await readBody(event)
  const parsed = ProductRecordSchema.safeParse(input)
  if (!parsed.success) failApi(400, 'E_VALIDATION', '提交内容不完整或格式错误')

  try {
    await appendRecord(parsed.data)
  } catch {
    failApi(500, 'E_WRITE_FAILED', '记录保存失败，请保留表单内容后重试')
  }

  setResponseStatus(event, 201)
  return parsed.data
})
