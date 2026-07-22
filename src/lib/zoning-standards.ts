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

/** 표에 넣을 "법정주차계획" 셀 텍스트 (주차장법 시행령 별표1) — 건축 용도 미지정 시 catch-all */
export const PARKING_STANDARD_CELL = "그 밖의 건축물: 300m2당 1대 (용도별 별도 기준 있음)"

/**
 * 주차장법 시행령 별표1 용도 분류 → 설치기준. 건축용도(자유 텍스트)를 키워드로 분류한다.
 * 순서 중요 — 더 구체적인 것(오피스텔·근린생활 종 구분)을 위에 둔다.
 * 별표 원문 대조 완료(2026-07, MST 273373).
 */
export interface ParkingUseRule {
  category: string
  rate: string
  /** 조례 별표 표에서 이 용도 행을 찾을 때 쓸 키워드(행 텍스트에 포함되면 매칭) */
  rowKeywords: string[]
}

const PARKING_USE_RULES: { match: RegExp; rule: ParkingUseRule }[] = [
  { match: /위락/, rule: { category: "위락시설", rate: "시설면적 100㎡당 1대", rowKeywords: ["위락"] } },
  { match: /오피스텔/, rule: { category: "업무시설 중 오피스텔", rate: "「주택건설기준」 제27조(전용면적별 산정)", rowKeywords: ["오피스텔"] } },
  { match: /(제?1종\s*근린|1종근린)/, rule: { category: "제1종 근린생활시설", rate: "시설면적 200㎡당 1대", rowKeywords: ["제1종 근린생활", "1종 근린", "근린생활"] } },
  { match: /(제?2종\s*근린|2종근린)/, rule: { category: "제2종 근린생활시설", rate: "시설면적 200㎡당 1대", rowKeywords: ["제2종 근린생활", "2종 근린", "근린생활"] } },
  { match: /근린생활/, rule: { category: "근린생활시설", rate: "시설면적 200㎡당 1대", rowKeywords: ["근린생활"] } },
  { match: /숙박/, rule: { category: "숙박시설", rate: "시설면적 200㎡당 1대", rowKeywords: ["숙박"] } },
  { match: /(업무|사무소|사무실|오피스(?!텔))/, rule: { category: "업무시설", rate: "시설면적 150㎡당 1대", rowKeywords: ["업무시설"] } },
  { match: /(판매|상점|백화점|쇼핑|마트|시장)/, rule: { category: "판매시설", rate: "시설면적 150㎡당 1대", rowKeywords: ["판매시설"] } },
  { match: /(문화|집회|공연|전시|영화|예식)/, rule: { category: "문화 및 집회시설", rate: "시설면적 150㎡당 1대", rowKeywords: ["문화 및 집회", "집회시설"] } },
  { match: /종교/, rule: { category: "종교시설", rate: "시설면적 150㎡당 1대", rowKeywords: ["종교시설"] } },
  { match: /(운수|터미널|정류장|여객)/, rule: { category: "운수시설", rate: "시설면적 150㎡당 1대", rowKeywords: ["운수시설"] } },
  { match: /(의료|병원|의원)/, rule: { category: "의료시설", rate: "시설면적 150㎡당 1대", rowKeywords: ["의료시설"] } },
  { match: /장례/, rule: { category: "장례식장", rate: "시설면적 150㎡당 1대", rowKeywords: ["장례"] } },
  { match: /운동/, rule: { category: "운동시설", rate: "시설면적 150㎡당 1대(골프장·옥외수영장 등 제외)", rowKeywords: ["운동시설"] } },
  { match: /창고/, rule: { category: "창고시설", rate: "시설면적 400㎡당 1대", rowKeywords: ["창고"] } },
  { match: /(공장|제조)/, rule: { category: "공장", rate: "시설면적 350㎡당 1대(아파트형 제외)", rowKeywords: ["공장"] } },
  { match: /수련/, rule: { category: "수련시설", rate: "시설면적 350㎡당 1대", rowKeywords: ["수련"] } },
  { match: /발전/, rule: { category: "발전시설", rate: "시설면적 350㎡당 1대", rowKeywords: ["발전"] } },
  { match: /다가구/, rule: { category: "다가구주택", rate: "「주택건설기준」 제27조(세대별 산정)", rowKeywords: ["다가구", "공동주택"] } },
  { match: /(공동주택|아파트|연립|다세대)/, rule: { category: "공동주택", rate: "「주택건설기준」 제27조(세대별 산정)", rowKeywords: ["공동주택"] } },
  { match: /단독/, rule: { category: "단독주택", rate: "50㎡초과~150㎡ 이하: 1대, 150㎡ 초과: 1대+초과 100㎡당 1대", rowKeywords: ["단독주택"] } },
]

/** 건축용도(자유 텍스트) → 주차장법 별표1 분류 규칙. 매칭 안 되면 null(그 밖의 건축물) */
export function resolveParkingUse(buildingUse?: string): ParkingUseRule | null {
  if (!buildingUse) return null
  const u = buildingUse.replace(/\s+/g, "")
  for (const { match, rule } of PARKING_USE_RULES) {
    if (match.test(buildingUse) || match.test(u)) return rule
  }
  return null
}

/** 표에 넣을 국가법령 주차 셀 — 건축용도 있으면 용도별 기준, 없으면 catch-all */
export function nationalParkingCell(buildingUse?: string): string {
  const rule = resolveParkingUse(buildingUse)
  if (!rule) return PARKING_STANDARD_CELL
  return `${rule.category}: ${rule.rate} (주차장법 시행령 별표1)`
}
