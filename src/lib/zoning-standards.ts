/**
 * 용도지역별 법정 건폐율·용적률 상한 및 조경·주차 기준 (법령상 참고치)
 *
 * 근거:
 *  - 건폐율: 국토의 계획 및 이용에 관한 법률 시행령 제84조제1항 (MST 287269, 2026-07-14 원문 대조)
 *  - 용적률: 같은 시행령 제85조제1항 (MST 287269, 2026-07-14 원문 대조)
 *  - 조경: 건축법 시행령 제27조 (MST 273503, 2026-07-14 원문 대조)
 *  - 주차: 주차장법 시행령 별표1 (MST 273373, 2026-07-14 원문 대조)
 *
 * 이 표의 수치는 "법령상 상한/기준"이며, 실제 적용 비율은 지방자치단체 도시·군계획조례/건축조례로
 * 정해지고 대개 이 범위보다 같거나 낮게 제한된다 — 정확한 값은 관할 지자체 조례 확인이 필요하다.
 */

export interface ZoningStandard {
  buildingCoverageMax: string
  floorAreaRatioRange: string
}

/** 국토계획법 시행령 제84조제1항 / 제85조제1항 — 용도지역 21종 */
export const ZONING_STANDARDS: Record<string, ZoningStandard> = {
  제1종전용주거지역: { buildingCoverageMax: "50% 이하", floorAreaRatioRange: "50~100%" },
  제2종전용주거지역: { buildingCoverageMax: "50% 이하", floorAreaRatioRange: "50~150%" },
  제1종일반주거지역: { buildingCoverageMax: "60% 이하", floorAreaRatioRange: "100~200%" },
  제2종일반주거지역: { buildingCoverageMax: "60% 이하", floorAreaRatioRange: "100~250%" },
  제3종일반주거지역: { buildingCoverageMax: "50% 이하", floorAreaRatioRange: "100~300%" },
  준주거지역: { buildingCoverageMax: "70% 이하", floorAreaRatioRange: "200~500%" },
  중심상업지역: { buildingCoverageMax: "90% 이하", floorAreaRatioRange: "200~1500%" },
  일반상업지역: { buildingCoverageMax: "80% 이하", floorAreaRatioRange: "200~1300%" },
  근린상업지역: { buildingCoverageMax: "70% 이하", floorAreaRatioRange: "200~900%" },
  유통상업지역: { buildingCoverageMax: "80% 이하", floorAreaRatioRange: "200~1100%" },
  전용공업지역: { buildingCoverageMax: "70% 이하", floorAreaRatioRange: "150~300%" },
  일반공업지역: { buildingCoverageMax: "70% 이하", floorAreaRatioRange: "150~350%" },
  준공업지역: { buildingCoverageMax: "70% 이하", floorAreaRatioRange: "150~400%" },
  보전녹지지역: { buildingCoverageMax: "20% 이하", floorAreaRatioRange: "50~80%" },
  생산녹지지역: { buildingCoverageMax: "20% 이하", floorAreaRatioRange: "50~100%" },
  자연녹지지역: { buildingCoverageMax: "20% 이하", floorAreaRatioRange: "50~100%" },
  보전관리지역: { buildingCoverageMax: "20% 이하", floorAreaRatioRange: "50~80%" },
  생산관리지역: { buildingCoverageMax: "20% 이하", floorAreaRatioRange: "50~80%" },
  계획관리지역: { buildingCoverageMax: "40% 이하", floorAreaRatioRange: "50~100%" },
  농림지역: { buildingCoverageMax: "20% 이하", floorAreaRatioRange: "50~80%" },
  자연환경보전지역: { buildingCoverageMax: "20% 이하", floorAreaRatioRange: "50~80%" },
}

const GREENBELT_ZONES = new Set(["보전녹지지역", "생산녹지지역", "자연녹지지역"])

export interface ZoningMatch {
  zoneName: string
  standard: ZoningStandard
}

/** 용도지역/지구 목록에서 21종 용도지역 중 하나를 찾아 건폐율/용적률 기준을 반환 (지구단위/구역 등은 매칭 안 됨) */
export function findZoningStandard(zones: string[]): ZoningMatch | null {
  for (const zone of zones) {
    const standard = ZONING_STANDARDS[zone]
    if (standard) return { zoneName: zone, standard }
  }
  return null
}

/** 표에 넣을 "법정최대건폐율" 셀 텍스트 */
export function buildingCoverageCell(zones: string[]): string {
  const match = findZoningStandard(zones)
  if (!match) return "- (용도지역 미확인)"
  return `${match.standard.buildingCoverageMax} (${match.zoneName})`
}

/** 표에 넣을 "법정최대용적율" 셀 텍스트 — 표는 간결하게, 근거 조문은 하단 각주로 별도 안내 */
export function floorAreaRatioCell(zones: string[]): string {
  const match = findZoningStandard(zones)
  if (!match) return "- (용도지역 미확인)"
  return `${match.standard.floorAreaRatioRange} (${match.zoneName})`
}

/**
 * 표에 넣을 "법정조경계획" 셀 텍스트 (건축법 시행령 제27조)
 * 녹지지역은 조경조치 면제 대상(제1항제1호). 그 외 일반 건축물은 연면적·용도별로 갈리고
 * 세부 비율은 대부분 지자체 건축조례 위임 사항이라 여기서는 기준 조문만 안내한다.
 */
export function landscapeCell(zones: string[]): string {
  if (zones.some((z) => GREENBELT_ZONES.has(z))) {
    return "녹지지역 — 조경 조치 면제 대상"
  }
  return "면적·용도별 기준 상이 — 조례 확인 필요"
}

/** 표에 넣을 "법정주차계획" 셀 텍스트 (주차장법 시행령 별표1) — 건축 용도가 정해져야 정확한 기준 적용 가능 */
export const PARKING_STANDARD_CELL = "그 밖의 건축물: 300m2당 1대 (용도별 별도 기준 있음)"
