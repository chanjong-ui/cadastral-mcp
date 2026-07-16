/**
 * 국가법령(시행령) 건폐율/용적률 기준 실시간 조회 — zoning-standards.ts(하드코딩 상수)의
 * 실시간 버전. 법제처 API로 매번 원문을 직접 읽어오므로 시행령이 개정돼도 자동으로 최신 값을
 * 반영한다. local-ordinance.ts와 완전히 같은 패턴(검색→조문 찾기→추출, 실패 시 null)이라
 * extractZonePercent/findZoneWindow를 그대로 재사용한다.
 *
 * 주차 기준(주차장법 시행령 별표1)은 여기 포함하지 않는다 — 별표는 조문과 달리 항/호/목으로
 * 구조화되어 있지 않고 HWP에서 추출된 고정폭 텍스트라 안정적으로 파싱하기 어렵다(표 경계를
 * 구분자 없이 공백 개수로만 판단해야 함). 원문을 오늘 직접 대조해 정확함을 이미 확인했으므로
 * zoning-standards.ts의 PARKING_STANDARD_CELL(하드코딩)을 계속 쓰고, 파싱은 나중 과제로 남긴다.
 *
 * 모든 함수는 실패 시(검색 실패/조문 못 찾음/파싱 실패/API 오류) null을 반환한다 —
 * 호출부(land-report-dxf.ts)는 null이면 zoning-standards.ts의 정적 상수로 폴백해야 한다.
 */

import { searchLaw, getLawArticles, type LawArticle } from "./national-law-api-client.js"
import { extractZonePercent, findZoneWindow } from "./local-ordinance.js"

export interface NationalStandardResult {
  value: string
  source: string
}

const lawCache = new Map<string, Promise<any>>()

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let entry = lawCache.get(key)
  if (!entry) {
    entry = fn().catch((error) => {
      lawCache.delete(key) // 실패는 캐시하지 않음 — 다음 요청에서 재시도 가능하게
      throw error
    })
    lawCache.set(key, entry)
  }
  return entry
}

async function findLawMst(lawName: string): Promise<string | null> {
  const results = await cached(`search:${lawName}`, () => searchLaw(lawName))
  if (results.length === 0) return null
  const exact = results.find((r) => r.name === lawName)
  return (exact || results[0]).mst || null
}

/**
 * 조문 제목은 신뢰할 수 없다 — 예: 국토계획법 시행령 제46조 제목이 "...건폐율 등의 완화적용"이라
 * "건폐율" 키워드로 찾으면 제84조(진짜 건폐율 조문)보다 먼저 매칭돼버린다(실사용 중 발견한 버그).
 * 대신 조번호로 정확히 찾는다 — 건폐율(제84조)/용적률(제85조)/조경(건축법 시행령 제27조)은
 * 법 개정으로 조문 "내용"은 바뀔 수 있어도 조번호 자체가 바뀌는 일은 거의 없는 안정적 인용이다
 * (이 세션에서 실제 원문 대조로 이미 확인됨).
 */
async function findArticleByNo(mst: string, articleNo: string): Promise<LawArticle | null> {
  const articles = await cached(`articles:${mst}`, () => getLawArticles(mst))
  return articles.find((a) => a.articleNo === articleNo) || null
}

/** "X% 이상 Y% 이하" 범위 표기 추출 — 국가법령 용적률(제85조)은 조례와 달리 단일값이 아니라 범위다 */
export function extractZoneRange(content: string, zoneName: string): { min: number; max: number } | null {
  const window = findZoneWindow(content, zoneName, 40)
  if (window === null) return null
  const m = window.match(
    /(\d+(?:,\d{3})*(?:\.\d+)?)\s*퍼센트\s*이상\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*퍼센트\s*이하/
  )
  if (!m) return null
  return { min: Number(m[1].replace(/,/g, "")), max: Number(m[2].replace(/,/g, "")) }
}

const ZONING_DECREE = "국토의 계획 및 이용에 관한 법률 시행령"
const BUILDING_COVERAGE_ARTICLE_NO = "84"
const FLOOR_AREA_RATIO_ARTICLE_NO = "85"

/** 국토계획법 시행령 제84조(건폐율)에서 특정 용도지역의 건폐율 상한을 실시간으로 찾는다 */
export async function getNationalBuildingCoverage(zoneName: string): Promise<NationalStandardResult | null> {
  try {
    const mst = await findLawMst(ZONING_DECREE)
    if (!mst) return null
    const article = await findArticleByNo(mst, BUILDING_COVERAGE_ARTICLE_NO)
    if (!article) return null
    const percent = extractZonePercent(article.content, zoneName)
    if (percent === null) return null
    return { value: `${percent}% 이하 (${zoneName})`, source: `국토계획법 시행령 제${article.articleNo}조` }
  } catch {
    return null
  }
}

/** 국토계획법 시행령 제85조(용적률)에서 특정 용도지역의 용적률 범위(하한~상한)를 실시간으로 찾는다 */
export async function getNationalFloorAreaRatio(zoneName: string): Promise<NationalStandardResult | null> {
  try {
    const mst = await findLawMst(ZONING_DECREE)
    if (!mst) return null
    const article = await findArticleByNo(mst, FLOOR_AREA_RATIO_ARTICLE_NO)
    if (!article) return null
    const range = extractZoneRange(article.content, zoneName)
    if (range === null) return null
    return { value: `${range.min}~${range.max}% (${zoneName})`, source: `국토계획법 시행령 제${article.articleNo}조` }
  } catch {
    return null
  }
}

const GREENBELT_ZONES = new Set(["보전녹지지역", "생산녹지지역", "자연녹지지역"])

/**
 * 건축법 시행령 제27조를 실제로 읽어보면(항①) 조경 "면적 %" 기준표가 아니라 "조경 조치 면제
 * 대상" 목록이다 — 국가법령 차원에는 전국 공통 조경 면적 비율표가 애초에 없고, 구체적 %는
 * 전부 지자체 건축조례로 위임되어 있다(그래서 zoning-standards.ts의 정적 안내문
 * "면적·용도별 기준 상이 — 조례 확인 필요"가 실제로 맞는 말이다 — "낡은 값"이 아니라 "국가
 * 법령에 값 자체가 없다"는 사실을 안내하는 것). 그래서 여기서는 녹지지역 면제 여부만 실시간
 * 확인하고, 그 외에는 null을 반환해 정적 안내문으로 폴백시킨다 — 굳이 면제 목록 전문을
 * 표에 채워넣는 것보다 이 편이 더 정확하고 간결하다.
 */
export async function getNationalLandscapeStandard(zones: string[]): Promise<NationalStandardResult | null> {
  if (zones.some((z) => GREENBELT_ZONES.has(z))) {
    return { value: "녹지지역 — 조경 조치 면제 대상", source: "건축법 시행령 제27조제1항제1호" }
  }
  return null
}
