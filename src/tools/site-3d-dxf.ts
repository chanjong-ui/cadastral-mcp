/**
 * export_site_3d_dxf
 * 수치지형도(등고선/표고점)로 지형 TIN + VWorld 건물(폴리곤+층수) extrude → 3D DXF.
 * 대지분석용 3D 매스 모델. 지형은 실측 데이터라 STURA3D식 90m DEM보다 정확.
 */

import { z } from "zod"
import * as fs from "fs"
import * as path from "path"
import { addressToPnu, getParcelGeometry, getBuildingsInBBox, boundingBoxOf } from "../lib/vworld-client.js"
import { readTopoDxf, clipTopoEntities, summarizeTopo } from "../lib/topo-dxf-reader.js"
import { collectElevationPoints, buildTin, build3dSiteDxf } from "../lib/terrain-3d.js"
import { CadastralApiError, formatToolError } from "../lib/errors.js"
import type { ToolResponse } from "../lib/types.js"

const DEFAULT_CRS = "EPSG:5186"
const DEFAULT_BUFFER_METERS = 100
const DEFAULT_FLOOR_HEIGHT = 3.3
const DEFAULT_GRID_CELL = 5 // 지형 격자 재샘플링 기본 간격(m) — 수치지형도 5m DEM급

function outputDir(): string {
  const dir = process.env.DXF_OUTPUT_DIR || path.join(process.cwd(), "output")
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const sharedFields = {
  topoDxfPath: z.string().describe("map.ngii.go.kr에서 받은 수치지형도 V1.0 DXF 절대경로 (등고선·표고점으로 지형 생성)"),
  bufferMeters: z
    .number()
    .optional()
    .describe(`대상 필지 주변 몇 m까지 3D로 만들지. 기본 ${DEFAULT_BUFFER_METERS}. 미지정 시 먼저 물어볼 것.`),
  floorHeight: z.number().optional().describe(`건물 층고(m). 높이=층수×층고. 기본 ${DEFAULT_FLOOR_HEIGHT}`),
  gridCell: z
    .number()
    .optional()
    .describe(
      `지형 표면 격자 재샘플링 간격(m). 지정 시 매끄러운 격자 곡면(기본 ${DEFAULT_GRID_CELL}m). 0으로 주면 raw TIN 삼각망.`
    ),
  crs: z.string().optional().describe(`좌표계 (기본 ${DEFAULT_CRS}, 수치지형도와 동일해야 함)`),
}

export const ExportSite3dDxfSchema = z.object({
  address: z.string().describe("지번 주소 (예: OO도 OO시 OO구 OO동 123-4)"),
  ...sharedFields,
})

export const ExportSite3dDxfByPnuSchema = z.object({
  pnu: z.string().describe("PNU 19자리"),
  ...sharedFields,
})

async function buildAndWrite(
  pnu: string,
  crs: string,
  bufferMeters: number,
  floorHeight: number,
  gridCell: number,
  topoDxfPath: string,
  refinedAddress?: string
) {
  if (!fs.existsSync(topoDxfPath)) {
    throw new CadastralApiError(`수치지형도 DXF 파일을 찾을 수 없습니다: ${topoDxfPath}`, [
      "map.ngii.go.kr에서 대상 지역 수치지형도(V1.0 DXF)를 먼저 다운로드하세요.",
    ])
  }

  const target = await getParcelGeometry(pnu, crs)
  if (!target || target.polygons.length === 0) {
    throw new CadastralApiError(`PNU ${pnu}의 지적 경계 데이터를 찾을 수 없습니다.`, ["PNU가 유효한 필지인지 확인하세요."])
  }

  const queryBBox = boundingBoxOf(target, bufferMeters)

  // 수치지형도 읽기 + 좌표계 정합 점검
  const allTopo = readTopoDxf(topoDxfPath)
  const topoSummary = summarizeTopo(allTopo)
  const overlaps =
    topoSummary.extent &&
    !(
      topoSummary.extent.maxX < queryBBox.minX ||
      topoSummary.extent.minX > queryBBox.maxX ||
      topoSummary.extent.maxY < queryBBox.minY ||
      topoSummary.extent.minY > queryBBox.maxY
    )
  if (!overlaps) {
    throw new CadastralApiError("수치지형도 도엽 범위가 대상 필지와 겹치지 않습니다.", [
      "대상 대지가 포함된 지역의 수치지형도를 받았는지 확인하세요.",
      "좌표계(EPSG:5186)가 일치하는지 확인하세요.",
    ])
  }

  const clipped = clipTopoEntities(allTopo, queryBBox)
  const elevPoints = collectElevationPoints(clipped)
  if (elevPoints.length < 3) {
    throw new CadastralApiError("지형을 만들 표고 데이터(등고선/표고점)가 부족합니다.", [
      "받으신 수치지형도에 등고선(F001)·표고점(F002) 레이어가 있는지 확인하세요.",
    ])
  }

  const tin = buildTin(elevPoints)
  const buildings = await getBuildingsInBBox(queryBBox, crs)
  const { dxfText, stats } = build3dSiteDxf(target, tin, buildings, queryBBox, floorHeight, gridCell, clipped)

  const filePath = path.join(outputDir(), `site_3d_${pnu}.dxf`)
  fs.writeFileSync(filePath, dxfText, "utf-8")

  return {
    ...(refinedAddress ? { 정제된주소: refinedAddress } : {}),
    PNU: pnu,
    지번: target.지번,
    좌표계: crs,
    버퍼미터: bufferMeters,
    층고: floorHeight,
    지형_격자간격m: gridCell > 0 ? gridCell : "raw TIN(격자 미사용)",
    지형_면수: stats.지형삼각형수,
    지형_표고점수: stats.표고점수,
    건물_조회수: stats.건물수,
    건물_extrude수: stats.extrude된건물수,
    도로_면: stats.도로면,
    도로_가장자리선: stats.도로선,
    하천_면: stats.하천면,
    파일경로: filePath,
    안내:
      "※ 3D DXF 대지 모델(참고용). 지형은 수치지형도 실측 등고선/표고점 기반이며, " +
      "건물 높이는 VWorld 지상층수 × 층고 추정값이라 실측 높이가 아닙니다. 정확한 측량은 지적측량성과도를 따르세요.",
  }
}

export async function exportSite3dDxf(_apiClient: unknown, args: z.infer<typeof ExportSite3dDxfSchema>): Promise<ToolResponse> {
  try {
    const { address, topoDxfPath, bufferMeters, floorHeight, gridCell, crs } = args
    const { pnu, refinedAddress } = await addressToPnu(address)
    const result = await buildAndWrite(
      pnu,
      crs || DEFAULT_CRS,
      bufferMeters ?? DEFAULT_BUFFER_METERS,
      floorHeight ?? DEFAULT_FLOOR_HEIGHT,
      gridCell ?? DEFAULT_GRID_CELL,
      topoDxfPath,
      refinedAddress
    )
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
  } catch (error) {
    return formatToolError(error, "export_site_3d_dxf")
  }
}

export async function exportSite3dDxfByPnu(
  _apiClient: unknown,
  args: z.infer<typeof ExportSite3dDxfByPnuSchema>
): Promise<ToolResponse> {
  try {
    const { pnu, topoDxfPath, bufferMeters, floorHeight, gridCell, crs } = args
    if (pnu.length !== 19) {
      return { content: [{ type: "text", text: `[ERROR] PNU는 19자리여야 합니다. 입력: ${pnu}` }], isError: true }
    }
    const result = await buildAndWrite(
      pnu,
      crs || DEFAULT_CRS,
      bufferMeters ?? DEFAULT_BUFFER_METERS,
      floorHeight ?? DEFAULT_FLOOR_HEIGHT,
      gridCell ?? DEFAULT_GRID_CELL,
      topoDxfPath
    )
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
  } catch (error) {
    return formatToolError(error, "export_site_3d_dxf_by_pnu")
  }
}
