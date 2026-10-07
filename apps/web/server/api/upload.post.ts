import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { UploadFileSchema } from '@scope/shared/schema'
import { failApi } from '../utils/api-error'
import { ensureUploadDirectory, uploadPath } from '../utils/store'

const maxUploadBytes = 5 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)
  const image = parts?.find((part) => part.name === 'image' && part.filename)
  if (!image) failApi(400, 'E_FORMAT', '请选择一张图片后再上传')
  if (image.data.length === 0) failApi(400, 'E_FORMAT', '图片内容为空')
  if (image.data.length > maxUploadBytes) failApi(413, 'E_SIZE', '图片超过 5MB，请压缩或裁剪后重试')

  const mime = sniffImageMime(image.data)
  if (!mime) failApi(415, 'E_FORMAT', '不支持该格式，请使用 JPG、PNG 或 WebP')

  const originalSizePart = parts?.find((part) => part.name === 'originalSize')
  const originalSizeText = originalSizePart?.data.toString('utf8')
  const originalSize = Number(originalSizeText)
  if (!Number.isSafeInteger(originalSize) || originalSize < 0) {
    failApi(400, 'E_FORMAT', '图片体积信息无效')
  }

  const fileId = randomUUID()
  const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp'
  const storedAs = `${fileId}.${extension}`
  await ensureUploadDirectory()
  await writeFile(uploadPath(storedAs), image.data, { flag: 'wx' })

  return UploadFileSchema.parse({
    fileId,
    originalName: sanitizeFileName(image.filename ?? '商品图片'),
    storedAs,
    originalSize,
    compressedSize: image.data.length,
    mime,
  })
})

function sniffImageMime(data: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | undefined {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

function sanitizeFileName(name: string): string {
  const baseName = name.replace(/[\\/]/g, '_').replace(/[\u0000-\u001f]/g, '').trim()
  return baseName.slice(0, 120) || '商品图片'
}
