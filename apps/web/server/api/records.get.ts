import { readRecords } from '../utils/store'

export default defineEventHandler(async () => readRecords())
