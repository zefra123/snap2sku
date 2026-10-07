import { RecognizeResultSchema } from '@scope/shared/schema'
import { failApi } from '../utils/api-error'
import { recognizeImage, type MockFixture } from '../utils/vision'

const fileIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default defineEventHandler(async (event) => {
  const body = await readBody<{ fileId?: unknown; mockFixture?: unknown }>(event)
  if (typeof body?.fileId !== 'string' || !fileIdPattern.test(body.fileId)) {
    failApi(400, 'E_VALIDATION', '图片编号无效')
  }
  const fixture: MockFixture = body.mockFixture === 'noTagPrice' ? 'noTagPrice' : 'tagPrice'
  const result = await recognizeImage(body.fileId, fixture, event)
  return RecognizeResultSchema.parse(result)
})
