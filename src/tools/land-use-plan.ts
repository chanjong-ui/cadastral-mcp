/**
 * get_land_use_plan / get_land_use_plan_by_pnu
 * 토지이용계획확인서 형태의 통합 리포트: 토지대장 + 용도지역지구 + 개별공시지가
 */

import { z } from "zod"
import {
  addressToPnu,
  getLandRegister,
  getLandUseZones,
  getIndividualLandPrice,
} from "../lib/vworld-client.js"
import { formatToolError } from "../lib/errors.js"
import type { ToolResponse } from "../lib/types.js"

const DISCLAIMER =
  "※ 본 정보는 브이월드(국토교통부) Open API 기준이며, 법적 효력이 있는 " +
  "「토지이용계획확인서」를 대체하지 않습니다. 정확한 확인은 토지이음(eum.go.kr) " +
  "또는 관할 행정청(시·군·구청 지적/도시계획 부서)에 문의하세요."

export const GetLandUsePlanSchema = z.object({
  address: z.string().describe("지번 주소 (예: OO도 OO시 OO구 OO동 123-4, 도로명 주소 아님)"),
  stdrYear: z.string().optional().describe("개별공시지가 기준연도 (미지정 시 올해)"),
})

export const GetLandUsePlanByPnuSchema = z.object({
  pnu: z.string().describe("PNU 19자리 (예: 1234567890123456789)"),
  stdrYear: z.string().optional().describe("개별공시지가 기준연도 (미지정 시 올해)"),
})

async function buildReport(pnu: string, stdrYear: string | undefined, refinedAddress?: string) {
  const [landRegister, landUseZones, individualLandPrice] = await Promise.all([
    getLandRegister(pnu),
    getLandUseZones(pnu),
    getIndividualLandPrice(pnu, stdrYear).catch(() => []),
  ])

  return {
    ...(refinedAddress ? { 정제된주소: refinedAddress } : {}),
    PNU: pnu,
    토지대장: landRegister ?? "조회 실패",
    용도지역지구: landUseZones.length > 0 ? landUseZones : "조회 결과 없음",
    개별공시지가: individualLandPrice.length > 0 ? individualLandPrice : "조회 결과 없음",
    안내: DISCLAIMER,
  }
}

export async function getLandUsePlan(
  _apiClient: unknown,
  args: z.infer<typeof GetLandUsePlanSchema>
): Promise<ToolResponse> {
  try {
    const { address, stdrYear } = args
    const { pnu, refinedAddress } = await addressToPnu(address)
    const result = await buildReport(pnu, stdrYear, refinedAddress)
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
  } catch (error) {
    return formatToolError(error, "get_land_use_plan")
  }
}

export async function getLandUsePlanByPnu(
  _apiClient: unknown,
  args: z.infer<typeof GetLandUsePlanByPnuSchema>
): Promise<ToolResponse> {
  try {
    const { pnu, stdrYear } = args
    if (pnu.length !== 19) {
      return {
        content: [{ type: "text", text: `[ERROR] PNU는 19자리여야 합니다. 입력: ${pnu} (${pnu.length}자리)` }],
        isError: true,
      }
    }
    const result = await buildReport(pnu, stdrYear)
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
  } catch (error) {
    return formatToolError(error, "get_land_use_plan_by_pnu")
  }
}
