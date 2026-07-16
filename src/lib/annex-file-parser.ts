/**
 * 별표 파일(HWP/HWPX/PDF 등) → 텍스트 파서. korean-law-mcp(lib/annex-file-parser.ts)와 동일하게
 * kordoc(MIT, https://github.com/chrisryugj/kordoc) 통합 파서에 위임한다.
 */

import { parse } from "kordoc"
import type { ParseResult, FileType } from "kordoc"

export interface AnnexParseResult {
  success: boolean
  markdown?: string
  fileType: FileType
  isImageBased?: boolean
  pageCount?: number
  error?: string
}

export async function parseAnnexFile(buffer: ArrayBuffer): Promise<AnnexParseResult> {
  const result: ParseResult = await parse(buffer)

  if (result.success) {
    return { success: true, fileType: result.fileType, markdown: result.markdown }
  }

  return {
    success: false,
    fileType: result.fileType,
    isImageBased: result.isImageBased,
    pageCount: result.pageCount,
    error: result.error,
  }
}
