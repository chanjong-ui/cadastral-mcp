/**
 * export_cadastral_dxf / export_cadastral_dxf_by_pnu
 * 지적 필지 경계(+주변 필지)를 DXF 파일로 내보내기 (연속지적도 기반)
 */

import { z } from "zod"
import * as fs from "fs"
import * as path from "path"
import {
  addressToPnu,
  getParcelGeometry,
  getParcelsInBBox,
  boundingBoxOf,
} from "../lib/vworld-client.js"
import { buildCadastralDxf, countVertices } from "../lib/dxf-builder.js"
import { CadastralApiError, formatToolError } from "../lib/errors.js"
import type { ToolResponse } from "../lib/types.js"

const DISCLAIMER =
  "※ 이 DXF는 브이월드(국토교통부) 2D데이터 API(연속지적도)에서 받은 경계 좌표로 생성한 " +
  "참고용 도면입니다. 법적 효력이 있는 지적측량성과도가 아니며, 실제 측량 결과와 다를 수 있습니다."

const DEFAULT_CRS = "EPSG:5186"
const DEFAULT_BUFFER_METERS = 50

function outputDir(): string {
  const dir = process.env.DXF_OUTPUT_DIR || path.join(process.cwd(), "output")
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const sharedFields = {
  crs: z.string().optional().describe(`출력 좌표계 EPSG 코드 (기본값: ${DEFAULT_CRS})`),
  includeNeighbors: z
    .boolean()
    .optional()
    .describe("주변 필지도 함께 그릴지 여부 (기본값: true)"),
  bufferMeters: z
    .number()
    .optional()
    .describe(`주변 필지 조회 범위(m). 기본값 ${DEFAULT_BUFFER_METERS}. 미지정 시 먼저 사용자에게 물어볼 것.`),
}

export const ExportCadastralDxfSchema = z.object({
  address: z.string().describe("지번 주소 (예: OO도 OO시 OO구 OO동 123-4, 도로명 주소 아님)"),
  ...sharedFields,
})

export const ExportCadastralDxfByPnuSchema = z.object({
  pnu: z.string().describe("PNU 19자리 (예: 1234567890123456789)"),
  ...sharedFields,
})

async function buildAndWriteDxf(
  pnu: string,
  crs: string,
  includeNeighbors: boolean,
  bufferMeters: number,
  refinedAddress?: string
) {
  const target = await getParcelGeometry(pnu, crs)
  if (!target || target.polygons.length === 0) {
    throw new CadastralApiError(`PNU ${pnu}의 지적 경계 데이터를 찾을 수 없습니다.`, [
      "PNU가 유효한 필지인지 확인하세요.",
      "지목이 없는 국유지·미등록지 등은 연속지적도에서 조회되지 않을 수 있습니다.",
    ])
  }

  const queryBBox = boundingBoxOf(target, bufferMeters)
  const neighbors = includeNeighbors ? await getParcelsInBBox(queryBBox, crs, pnu) : []

  const dxfText = buildCadastralDxf(target, neighbors, queryBBox)
  const filePath = path.join(outputDir(), `cadastral_${pnu}.dxf`)
  fs.writeFileSync(filePath, dxfText, "utf-8")

  return {
    ...(refinedAddress ? { 정제된주소: refinedAddress } : {}),
    PNU: pnu,
    지번: target.지번,
    좌표계: crs,
    대상필지_폴리곤수: target.polygons.length,
    대상필지_정점수: countVertices(target),
    주변필지_포함: includeNeighbors,
    주변필지_수: neighbors.length,
    주변필지_버퍼미터: bufferMeters,
    제곱미터당공시지가: target.제곱미터당공시지가 || "조회 결과 없음",
    파일경로: filePath,
    안내: DISCLAIMER,
  }
}

export async function exportCadastralDxf(
  _apiClient: unknown,
  args: z.infer<typeof ExportCadastralDxfSchema>
): Promise<ToolResponse> {
  try {
    const { address, crs, includeNeighbors, bufferMeters } = args
    const { pnu, refinedAddress } = await addressToPnu(address)
    const result = await buildAndWriteDxf(
      pnu,
      crs || DEFAULT_CRS,
      includeNeighbors ?? true,
      bufferMeters ?? DEFAULT_BUFFER_METERS,
      refinedAddress
    )
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
  } catch (error) {
    return formatToolError(error, "export_cadastral_dxf")
  }
}

export async function exportCadastralDxfByPnu(
  _apiClient: unknown,
  args: z.infer<typeof ExportCadastralDxfByPnuSchema>
): Promise<ToolResponse> {
  try {
    const { pnu, crs, includeNeighbors, bufferMeters } = args
    if (pnu.length !== 19) {
      return {
        content: [{ type: "text", text: `[ERROR] PNU는 19자리여야 합니다. 입력: ${pnu} (${pnu.length}자리)` }],
        isError: true,
      }
    }
    const result = await buildAndWriteDxf(
      pnu,
      crs || DEFAULT_CRS,
      includeNeighbors ?? true,
      bufferMeters ?? DEFAULT_BUFFER_METERS
    )
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
  } catch (error) {
    return formatToolError(error, "export_cadastral_dxf_by_pnu")
  }
}
