import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { ProductRecordSchema, type ProductRecord } from '@scope/shared/schema'

const dataDirectory = fileURLToPath(new URL('../../../../data/', import.meta.url))
const uploadsDirectory = fileURLToPath(new URL('../../../../data/uploads/', import.meta.url))
const recordsPath = fileURLToPath(new URL('../../../../data/records.json', import.meta.url))

let writeQueue: Promise<void> = Promise.resolve()

export async function ensureUploadDirectory(): Promise<void> {
  await mkdir(uploadsDirectory, { recursive: true })
}

export function uploadPath(storedAs: string): string {
  return fileURLToPath(new URL(`../../../../data/uploads/${storedAs}`, import.meta.url))
}

export async function findUploadPath(fileId: string): Promise<string | undefined> {
  await ensureUploadDirectory()
  const files = await readdir(uploadsDirectory)
  const match = files.find((file) => file.startsWith(`${fileId}.`))
  return match ? uploadPath(match) : undefined
}

export async function readRecords(): Promise<ProductRecord[]> {
  await mkdir(dataDirectory, { recursive: true })
  try {
    const contents = await readFile(recordsPath, 'utf8')
    const parsed: unknown = JSON.parse(contents)
    if (!Array.isArray(parsed)) throw new Error('records.json must contain an array')
    return parsed.map((record) => ProductRecordSchema.parse(record))
  } catch (error) {
    if (isMissingFile(error)) return []
    throw error
  }
}

export async function appendRecord(record: ProductRecord): Promise<void> {
  const write = writeQueue.then(async () => {
    await mkdir(dataDirectory, { recursive: true })
    const current = await readRecords()
    const temporaryPath = `${recordsPath}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify([...current, record], null, 2)}\n`, 'utf8')
    await rename(temporaryPath, recordsPath)
  })
  writeQueue = write.then(() => undefined, () => undefined)
  await write
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
