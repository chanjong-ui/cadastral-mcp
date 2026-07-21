/**
 * export_land_report_dxf / export_land_report_dxf_by_pnu
 * 한 페이지 DXF: 좌(요청 정보) + 우상단(토지이용계획) + 우하단(지적도)
 */

import { z } from "zod"
import * as fs from "fs"
import * as path from "path"
import {
  addressToPnu,
  getLandRegister,
  getLandUseZones,
  getIndividualLandPrice,
  getParcelGeometry,
  getParcelsInBBox,
  boundingBoxOf,
} from "../lib/vworld-client.js"
import { buildLandReportDxf, type LandReportInfo } from "../lib/dxf-builder.js"
import { readTopoDxf, clipTopoEntities, summarizeTopo, type TopoEntity } from "../lib/topo-dxf-reader.js"
import { applyXclip } from "../lib/xclip.js"
import { findZoningStandard, buildingCoverageCell, floorAreaRatioCell, landscapeCell } from "../lib/zoning-standards.js"
import {
  getLocalBuildingCoverage,
  getLocalFloorAreaRatio,
  getLocalLandscapeStandard,
  getLocalParkingStandard,
} from "../lib/local-ordinance.js"
import {
  getNationalBuildingCoverage,
  getNationalFloorAreaRatio,
  getNationalLandscapeStandard,
} from "../lib/national-law.js"
import { CadastralApiError, formatToolError } from "../lib/errors.js"
import type { ToolResponse } from "../lib/types.js"

const DISCLAIMER =
  "※ 이 DXF는 브이월드(국토교통부) API 데이터로 생성한 참고용 자료입니다. " +
  "법적 효력이 있는 토지이용계획확인서·지적측량성과도가 아니며, 실제와 다를 수 있습니다."

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
    .describe("지적도 패널에 주변 필지도 함께 그릴지 여부 (기본값: true)"),
  bufferMeters: z
    .number()
    .optional()
    .describe(`주변 필지 조회 범위(m). 기본값 ${DEFAULT_BUFFER_METERS}. 미지정 시 먼저 사용자에게 물어볼 것.`),
  stdrYear: z.string().optional().describe("개별공시지가 기준연도 (미지정 시 올해)"),
  topoDxfPath: z
    .string()
    .optional()
    .describe(
      "(선택) map.ngii.go.kr에서 받은 수치지형도 V1.0 DXF 절대경로. 주면 지적도 패널에 등고선·건물·도로·하천이 함께 겹쳐 그려짐."
    ),
}

export const ExportLandReportDxfSchema = z.object({
  address: z.string().describe("지번 주소 (예: OO도 OO시 OO구 OO동 123-4, 도로명 주소 아님)"),
  ...sharedFields,
})

export const ExportLandReportDxfByPnuSchema = z.object({
  pnu: z.string().describe("PNU 19자리 (예: 1234567890123456789)"),
  ...sharedFields,
})

async function buildAndWriteReport(
  pnu: string,
  crs: string,
  includeNeighbors: boolean,
  bufferMeters: number,
  stdrYear: string | undefined,
  refinedAddress?: string,
  topoDxfPath?: string
) {
  const target = await getParcelGeometry(pnu, crs)
  if (!target || target.polygons.length === 0) {
    throw new CadastralApiError(`PNU ${pnu}의 지적 경계 데이터를 찾을 수 없습니다.`, [
      "PNU가 유효한 필지인지 확인하세요.",
      "지목이 없는 국유지·미등록지 등은 연속지적도에서 조회되지 않을 수 있습니다.",
    ])
  }

  const queryBBox = boundingBoxOf(target, bufferMeters)

  // (선택) 수치지형도 DXF가 주어지면 읽어서 대상 필지 버퍼 범위로 클립
  let topoEntities: TopoEntity[] | undefined
  let topoStatus = "미첨부 (topoDxfPath 없음 — 지적도만 표시)"
  if (topoDxfPath) {
    if (!fs.existsSync(topoDxfPath)) {
      topoStatus = `⚠ 파일 없음: ${topoDxfPath} — 지형 없이 진행`
    } else {
      const all = readTopoDxf(topoDxfPath)
      const summary = summarizeTopo(all)
      const overlaps =
        summary.extent &&
        !(
          summary.extent.maxX < queryBBox.minX ||
          summary.extent.minX > queryBBox.maxX ||
          summary.extent.maxY < queryBBox.minY ||
          summary.extent.minY > queryBBox.maxY
        )
      if (!overlaps) {
        topoStatus = "⚠ 수치지형도 도엽 범위가 대상 필지와 겹치지 않음 — 다른 지역 도엽이거나 좌표계 불일치. 지형 생략"
      } else {
        topoEntities = clipTopoEntities(all, queryBBox)
        topoStatus = `첨부됨 — 클립 후 ${topoEntities.length}개 지형 엔티티를 지적도 패널에 겹침`
      }
    }
  }
  const [neighbors, landRegister, landUseZones, individualLandPrice] = await Promise.all([
    includeNeighbors ? getParcelsInBBox(queryBBox, crs, pnu) : Promise.resolve([]),
    getLandRegister(pnu),
    getLandUseZones(pnu),
    getIndividualLandPrice(pnu, stdrYear).catch(() => []),
  ])

  const price = individualLandPrice[0]
  const 법정동명 = landRegister?.법정동명 || target.주소 || ""

  // 지자체 조례에서 실제 건폐율/용적률/조경/주차 기준 조회 시도.
  // 국가법령 상한도 (주차 제외) 법제처 API로 실시간 조회 시도 — 실패하면 zoning-standards.ts의
  // 검증된 상수로 폴백한다(주차는 별표 파싱이 아직 없어 처음부터 상수만 씀, national-law.ts 주석 참고).
  // 조례 쪽이 실패하면(null) info에 undefined로 남고, dxf-builder.ts가 "자동조회 실패" 문구로 채운다.
  const zoneMatch = findZoningStandard(landUseZones)
  const [localCoverage, localFar, localLandscape, localParking, nationalCoverage, nationalFar, nationalLandscape] =
    await Promise.all([
      // 건폐율/용적률은 용도지역명이 있어야 조문 안에서 값을 특정할 수 있어 매칭 실패 시 스킵
      zoneMatch ? getLocalBuildingCoverage(법정동명, zoneMatch.zoneName) : Promise.resolve(null),
      zoneMatch ? getLocalFloorAreaRatio(법정동명, zoneMatch.zoneName) : Promise.resolve(null),
      // 조경/주차는 용도지역명과 무관하게 시/군 조례만 찾으면 되므로 항상 시도
      getLocalLandscapeStandard(법정동명),
      getLocalParkingStandard(법정동명),
      zoneMatch ? getNationalBuildingCoverage(zoneMatch.zoneName) : Promise.resolve(null),
      zoneMatch ? getNationalFloorAreaRatio(zoneMatch.zoneName) : Promise.resolve(null),
      getNationalLandscapeStandard(landUseZones),
    ])

  const info: LandReportInfo = {
    요청주소: refinedAddress,
    PNU: pnu,
    법정동명,
    지번: target.지번 || landRegister?.지번 || "",
    지목: landRegister?.지목 || "",
    면적: landRegister?.면적 || "",
    소유구분: landRegister?.소유구분 || "",
    용도지역지구: landUseZones,
    공시기준연도: price?.기준연도 || "",
    제곱미터당공시지가: price?.제곱미터당공시지가 || target.제곱미터당공시지가 || "",
    버퍼미터: bufferMeters,
    좌표계: crs,
    생성일시: new Date().toISOString(),
    조례최대건폐율: localCoverage ? `${localCoverage.value} (${localCoverage.source})` : undefined,
    조례최대용적율: localFar ? `${localFar.value} (${localFar.source})` : undefined,
    조례조경계획: localLandscape ? `${localLandscape.value} (${localLandscape.source})` : undefined,
    조례주차계획: localParking ? `${localParking.value} (${localParking.source})` : undefined,
    // 국가법령: 실시간 조회(national-law.ts) 성공 시 그 값+출처조문, 실패 시 zoning-standards.ts
    // 정적 상수로 폴백 — 어느 쪽이든 항상 채워진 문자열이 되도록 한다.
    법정최대건폐율: nationalCoverage
      ? `${nationalCoverage.value} (${nationalCoverage.source})`
      : buildingCoverageCell(landUseZones),
    법정최대용적율: nationalFar
      ? `${nationalFar.value} (${nationalFar.source})`
      : floorAreaRatioCell(landUseZones),
    법정조경계획: nationalLandscape
      ? `${nationalLandscape.value} (${nationalLandscape.source})`
      : landscapeCell(landUseZones),
  }

  const { dxfText, mapBlockName, mapClipBox } = buildLandReportDxf(target, neighbors, queryBBox, info, topoEntities)
  const filePath = path.join(outputDir(), `land_report_${pnu}.dxf`)
  fs.writeFileSync(filePath, dxfText, "utf-8")

  const xclip = await applyXclip(filePath, mapBlockName, mapClipBox)

  return {
    ...(refinedAddress ? { 정제된주소: refinedAddress } : {}),
    PNU: pnu,
    지번: info.지번,
    좌표계: crs,
    주변필지_포함: includeNeighbors,
    주변필지_수: neighbors.length,
    주변필지_버퍼미터: bufferMeters,
    토지이용계획: {
      토지대장: landRegister ?? "조회 실패",
      용도지역지구: landUseZones.length > 0 ? landUseZones : "조회 결과 없음",
      개별공시지가: price ?? "조회 결과 없음",
    },
    지자체조례_조회: {
      건폐율: info.조례최대건폐율 ? "조회 성공 — 법령·조례 값 함께 표에 표시" : "조회 실패 — 조례 칸에 실패 안내 표시",
      용적률: info.조례최대용적율 ? "조회 성공 — 법령·조례 값 함께 표에 표시" : "조회 실패 — 조례 칸에 실패 안내 표시",
      조경: info.조례조경계획 ? "조회 성공 — 법령·조례 값 함께 표에 표시" : "조회 실패 — 조례 칸에 실패 안내 표시",
      주차: info.조례주차계획 ? "조회 성공 — 법령·조례 값 함께 표에 표시" : "조회 실패 — 조례 칸에 실패 안내 표시",
    },
    국가법령_조회: {
      건폐율: nationalCoverage ? "법제처 API 실시간 조회 성공" : "실시간 조회 실패 — 검증된 고정값으로 대체",
      용적률: nationalFar ? "법제처 API 실시간 조회 성공" : "실시간 조회 실패 — 검증된 고정값으로 대체",
      조경: nationalLandscape
        ? "법제처 API 실시간 조회 성공(녹지지역 면제 확인)"
        : "국가법령상 전국 공통 조경 면적 기준 자체가 없음(지자체 건축조례 위임 사항) — 안내 문구로 대체",
      주차: "고정값 사용 (주차장법 시행령 별표1은 구조화되지 않은 원문이라 실시간 파싱 미지원)",
    },
    지적도_XCLIP크롭: xclip.applied ? "적용됨" : `미적용 — ${xclip.message}`,
    수치지형도_병합: topoStatus,
    파일경로: filePath,
    안내: DISCLAIMER,
  }
}

export async function exportLandReportDxf(
  _apiClient: unknown,
  args: z.infer<typeof ExportLandReportDxfSchema>
): Promise<ToolResponse> {
  try {
    const { address, crs, includeNeighbors, bufferMeters, stdrYear, topoDxfPath } = args
    const { pnu, refinedAddress } = await addressToPnu(address)
    const result = await buildAndWriteReport(
      pnu,
      crs || DEFAULT_CRS,
      includeNeighbors ?? true,
      bufferMeters ?? DEFAULT_BUFFER_METERS,
      stdrYear,
      refinedAddress,
      topoDxfPath
    )
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
  } catch (error) {
    return formatToolError(error, "export_land_report_dxf")
  }
}

export async function exportLandReportDxfByPnu(
  _apiClient: unknown,
  args: z.infer<typeof ExportLandReportDxfByPnuSchema>
): Promise<ToolResponse> {
  try {
    const { pnu, crs, includeNeighbors, bufferMeters, stdrYear, topoDxfPath } = args
    if (pnu.length !== 19) {
      return {
        content: [{ type: "text", text: `[ERROR] PNU는 19자리여야 합니다. 입력: ${pnu} (${pnu.length}자리)` }],
        isError: true,
      }
    }
    const result = await buildAndWriteReport(
      pnu,
      crs || DEFAULT_CRS,
      includeNeighbors ?? true,
      bufferMeters ?? DEFAULT_BUFFER_METERS,
      stdrYear,
      undefined,
      topoDxfPath
    )
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
  } catch (error) {
    return formatToolError(error, "export_land_report_dxf_by_pnu")
  }
}
