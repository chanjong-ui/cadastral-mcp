/**
 * 지자체 조례 자동 조회 — 건폐율/용적률/조경 기준을 국가법령 상한이 아니라
 * 관할 지자체 도시계획조례·건축조례의 실제 수치로 채운다.
 *
 * 조문번호는 목차 순서와 일치하지 않는 경우가 많아(가지번호·삭제 조문 등),
 * 조문번호를 추측하는 대신 전체 조문을 한 번에 받아 키워드로 직접 찾는다
 * (get_ordinance를 jo 없이 호출하면 법제처 API가 조문 전체를 반환함).
 *
 * 모든 함수는 실패 시(조례 못 찾음/조문 못 찾음/파싱 실패/API 오류) null을 반환한다 —
 * 호출부는 null이면 국가법령 기준(zoning-standards.ts)으로 폴백해야 한다.
 */

import {
  searchOrdinance,
  getOrdinanceArticles,
  getOrdinanceAnnexList,
  downloadAnnexFile,
  type OrdinanceArticle,
} from "./law-api-client.js"
import { parseAnnexFile } from "./annex-file-parser.js"
import { ZONING_STANDARDS } from "./zoning-standards.js"

const ALL_ZONE_NAMES = Object.keys(ZONING_STANDARDS)

export interface LocalStandardResult {
  value: string
  source: string
}

// 검색·조문 결과 캐시 (프로세스 생존 기간 동안 재사용 — 조례는 자주 안 바뀜)
const ordinanceCache = new Map<string, Promise<any>>()

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let entry = ordinanceCache.get(key)
  if (!entry) {
    entry = fn().catch((error) => {
      ordinanceCache.delete(key) // 실패는 캐시하지 않음 — 다음 요청에서 재시도 가능하게
      throw error
    })
    ordinanceCache.set(key, entry)
  }
  return entry
}

/**
 * "OO도 OO시 OO구 OO동" → ["OO시", "OO도"]
 * 시/군 조례가 보통 우선(도시계획·건축은 시·군 사무)이고, 특별시·광역시는
 * 상위 단위(예: 서울특별시) 조례를 쓰므로 두 후보를 순서대로 시도한다.
 */
export function extractCityCandidates(법정동명: string): string[] {
  const parts = 법정동명.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return []

  const candidates: string[] = []
  if (parts.length >= 2 && /(시|군|구)$/.test(parts[1])) {
    candidates.push(parts[1])
  }
  if (parts[0] && /(특별시|광역시|특별자치시|특별자치도|도)$/.test(parts[0])) {
    candidates.push(parts[0])
  }
  return [...new Set(candidates)]
}

async function findBestOrdinance(city: string, keyword: string) {
  const key = `search:${city}:${keyword}`
  const results = await cached(key, () => searchOrdinance(`${city} ${keyword}`))
  if (results.length === 0) return null
  const exact = results.find((r: any) => r.name === `${city} ${keyword}`)
  return exact || results[0]
}

async function findArticle(
  ordinSeq: string,
  mustIncludeAll: string[]
): Promise<OrdinanceArticle | null> {
  const articles = await cached(`articles:${ordinSeq}`, () => getOrdinanceArticles(ordinSeq))
  return articles.find((a) => mustIncludeAll.every((kw) => a.content.includes(kw))) || null
}

/** 제목이 titleKeyword를 포함하는 조문을 우선 찾고, 없으면 본문 키워드 매칭으로 폴백 */
async function findArticleByTitleOrContent(
  ordinSeq: string,
  titleKeyword: string,
  contentMustIncludeAll: string[]
): Promise<OrdinanceArticle | null> {
  const articles = await cached(`articles:${ordinSeq}`, () => getOrdinanceArticles(ordinSeq))
  const byTitle = articles.find((a) => a.title.includes(titleKeyword))
  if (byTitle) return byTitle
  return articles.find((a) => contentMustIncludeAll.every((kw) => a.content.includes(kw))) || null
}

export function articleCitation(ordName: string, article: OrdinanceArticle): string {
  // 조번호는 article.title(조제목)이 아니라 article.content 맨 앞("제45조(...)")에 있다
  const match = article.content.match(/제\d+조(의\d+)?/)
  return `${ordName} ${match ? match[0] : article.title}`
}

/**
 * "생산녹지지역：100분의 20" / "생산녹지지역 : 20퍼센트" / "생산녹지지역: 20%" 전부 매칭.
 *
 * 원본 조문 텍스트는 항목 사이에 공백이 없어("...100분의 2016. 자연녹지지역...") 값과 다음
 * 항목번호가 붙어버린다. 그래서 (1) 이 지역명 뒤 ~ 다음 알려진 용도지역명이 나오기 전까지로
 * 창을 좁히고, (2) 창 끝에 붙은 "다음 항목번호."를 잘라낸 뒤 숫자를 뽑는다. 안전상 창은
 * 최대 20자로도 제한한다(마지막 항목이라 다음 지역명이 없는 경우 대비).
 *
 * "다음 항목번호"를 최대 2자리 숫자로 무작정 추측(\d{1,2})하면, 값의 마지막 자리와 다음
 * 항목번호가 우연히 이어져("제1종일반주거지역：100분의 604. 제2종일반주거지역") "04."를
 * 통째로 항목번호로 착각해 값 "60"의 "0"까지 지워버려 "6"으로 잘리는 버그가 있었다(실사용
 * 중 발견). 이 조례들이 법령(제84·85조)과 같은 21개 용도지역 표준 순서를 따른다는 점을
 * 이용해, 다음에 나온 용도지역이 정말 "바로 다음 순번"이면 그 정확한 항목번호만 제거하고,
 * 아니면(순서를 알 수 없으면) 기존의 추측 방식으로 폴백한다.
 */
/**
 * 용도지역명 뒤 ~ 다음 알려진 용도지역명이 나오기 전까지로 창을 좁히고, 창 끝에 붙은
 * "다음 항목번호."를 잘라낸 "값 부분만 남은" 텍스트 조각을 반환한다. extractZonePercent(단일
 * 값, 조례/건폐율)와 national-law.ts의 범위 추출(용적률, "X% 이상 Y% 이하")이 공유한다.
 */
export function findZoneWindow(content: string, zoneName: string, maxWindow = 20): string | null {
  const startIdx = content.indexOf(zoneName)
  if (startIdx === -1) return null

  const afterZoneName = startIdx + zoneName.length
  let windowEnd = afterZoneName + maxWindow
  let nextZoneName: string | null = null
  for (const other of ALL_ZONE_NAMES) {
    if (other === zoneName) continue
    const idx = content.indexOf(other, afterZoneName)
    if (idx !== -1 && idx < windowEnd) {
      windowEnd = idx
      nextZoneName = other
    }
  }

  let window = content.slice(afterZoneName, windowEnd)

  const zoneIndex = ALL_ZONE_NAMES.indexOf(zoneName)
  const nextZoneIndex = nextZoneName ? ALL_ZONE_NAMES.indexOf(nextZoneName) : -1
  if (nextZoneName && nextZoneIndex === zoneIndex + 1) {
    const nextItemNo = nextZoneIndex + 1 // 항목번호는 1부터 시작(배열은 0부터)
    window = window.replace(new RegExp(`${nextItemNo}\\.\\s*$`), "")
  } else {
    window = window.replace(/\d{1,2}\.\s*\S*$/, "")
  }

  return window
}

export function extractZonePercent(content: string, zoneName: string): number | null {
  const window = findZoneWindow(content, zoneName)
  if (window === null) return null

  const m = window.match(/(?:100분의\s*(\d+(?:\.\d+)?)|(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:퍼센트|%))/)
  if (!m) return null
  const raw = (m[1] ?? m[2] ?? "").replace(/,/g, "")
  return raw ? Number(raw) : null
}

const BUILDING_COVERAGE_ANCHOR = "제1종전용주거지역" // 21개 용도지역 표에 항상 등장하는 앵커 키워드

/** 지자체 도시계획조례에서 특정 용도지역의 건폐율 상한을 찾는다 */
export async function getLocalBuildingCoverage(
  법정동명: string,
  zoneName: string
): Promise<LocalStandardResult | null> {
  try {
    for (const city of extractCityCandidates(법정동명)) {
      const ord = await findBestOrdinance(city, "도시계획 조례")
      if (!ord) continue
      const article = await findArticle(ord.ordinSeq, ["건폐율", BUILDING_COVERAGE_ANCHOR, zoneName])
      if (!article) continue
      const percent = extractZonePercent(article.content, zoneName)
      if (percent === null) continue
      return { value: `${percent}% 이하`, source: articleCitation(ord.name, article) }
    }
    return null
  } catch {
    return null
  }
}

/** 지자체 도시계획조례에서 특정 용도지역의 용적률 상한을 찾는다 */
export async function getLocalFloorAreaRatio(
  법정동명: string,
  zoneName: string
): Promise<LocalStandardResult | null> {
  try {
    for (const city of extractCityCandidates(법정동명)) {
      const ord = await findBestOrdinance(city, "도시계획 조례")
      if (!ord) continue
      const article = await findArticle(ord.ordinSeq, ["용적률", BUILDING_COVERAGE_ANCHOR, zoneName])
      if (!article) continue
      const percent = extractZonePercent(article.content, zoneName)
      if (percent === null) continue
      return { value: `${percent}% 이하`, source: articleCitation(ord.name, article) }
    }
    return null
  } catch {
    return null
  }
}

/**
 * 조문에서 "①...②" 사이(첫 번째 항)만 뽑는다. 조경 기준은 보통 항①의 번호 목록(1./2./3.)에
 * 연면적 구간별 수치가 다 들어있고, 그 뒤 항(②③④…)은 산정방법·면제대상 등 표에 넣기엔
 * 과도하게 긴 부연설명이라 잘라내도 핵심 수치 손실이 없다. ①이 없으면 전체를 그대로 쓴다.
 */
export function extractFirstParagraph(content: string): string {
  const start = content.indexOf("①")
  if (start === -1) return content
  const end = content.indexOf("②", start + 1)
  return end === -1 ? content.slice(start) : content.slice(start, end)
}

/** 지자체 건축조례에서 조경 관련 조문을 찾아 원문 요약을 반환 (수치가 연면적별로 갈려 파싱 대신 원문 발췌) */
export async function getLocalLandscapeStandard(법정동명: string): Promise<LocalStandardResult | null> {
  try {
    for (const city of extractCityCandidates(법정동명)) {
      const ord = await findBestOrdinance(city, "건축 조례")
      if (!ord) continue
      const article = await findArticleByTitleOrContent(ord.ordinSeq, "조경", ["조경면적", "제곱미터"])
      if (!article) continue
      // 항① 전체(연면적 구간별 수치 목록)를 자르지 않고 다 보여준다 — 도시마다 구간이 3단계일
      // 수도, 6단계 이상일 수도 있어(부안군 3단계 vs 전주시 6단계로 실사용 중 확인) 임의
      // 글자수로 자르지 않는다. 표 행 높이는 drawInfoTable(dxf-builder.ts)이 줄바꿈 줄수에
      // 맞춰 자동으로 늘어난다.
      const excerpt = extractFirstParagraph(article.content).replace(/\s+/g, " ").trim()
      return { value: excerpt, source: articleCitation(ord.name, article) }
    }
    return null
  } catch {
    return null
  }
}

/** 별표 마크다운 표에서 "기타/그 밖의 시설물" 행의 설치기준 셀을 찾는다 (도시마다 문구가 조금씩 다름) */
export function extractOtherFacilityParkingRate(markdown: string): string | null {
  for (const line of markdown.split("\n")) {
    if (!line.trim().startsWith("|")) continue
    if (!/\d+\.\s*(기타|그\s*밖)/.test(line)) continue
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean)
    if (cells.length >= 2) return cells[cells.length - 1].replace(/<br\s*\/?>/g, " ").trim()
  }
  return null
}

/**
 * 별표 마크다운 표에서 특정 건축용도 행의 설치기준 셀을 찾는다. rowKeywords 중 하나라도 행
 * 첫 셀(시설물명)에 포함되면 그 행으로 본다. 못 찾으면 null(호출부가 '기타' 행으로 폴백).
 */
export function extractFacilityParkingRate(markdown: string, rowKeywords: string[]): string | null {
  for (const line of markdown.split("\n")) {
    if (!line.trim().startsWith("|")) continue
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean)
    if (cells.length < 2) continue
    const nameCell = cells[0]
    if (rowKeywords.some((kw) => nameCell.includes(kw))) {
      return cells[cells.length - 1].replace(/<br\s*\/?>/g, " ").trim()
    }
  }
  return null
}

/**
 * "영 제6조제1항의 별표 1과 같다"처럼 조문이 이 조례가 아니라 상위법령(영/법/규칙)의
 * 별표를 그대로 인용하는 경우가 많다 — 이 경우 조례 자체에는 별도 기준표가 없다는 뜻이므로,
 * "별표 N"이라는 숫자만 보고 이 조례의 별표 목록에서 N번을 가져오면 안 된다(전혀 다른 별표를
 * 잘못 집어올 수 있음). 매치 직전 텍스트에 "영/법/규칙" 등 타법령 인용어가 있으면 건너뛴다.
 */
const EXTERNAL_ANNEX_REF = /(영|법|규칙|시행령|시행규칙)\s*(제\d+조(?:의\d+)?)?\s*(제\d+항)?\s*(?:의)?\s*$/

export function findSelfAnnexNumber(content: string): string | null {
  const re = /별표\s*(\d+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content))) {
    const preceding = content.slice(Math.max(0, m.index - 15), m.index)
    if (EXTERNAL_ANNEX_REF.test(preceding)) continue
    return m[1]
  }
  return null
}

/**
 * 지자체 주차장 조례에서 부설주차장 설치기준을 찾는다. 구체적 수치는 조문 본문이 아니라
 * 별표(HWP/PDF 첨부파일)로 위임된 경우가 많아, 조문에서 "별표N" 인용을 발견하면
 * 별표 목록을 검색해 해당 파일을 다운로드받아 kordoc으로 파싱한 뒤 "기타/그 밖의 시설물"
 * 행을 뽑는다. 파일을 못 찾거나 파싱에 실패하면 조번호·별표번호까지만 알려주고
 * (수치를 지어내지 않는다) 관할 지자체 확인을 안내한다.
 */
export async function getLocalParkingStandard(
  법정동명: string,
  rowKeywords?: string[]
): Promise<LocalStandardResult | null> {
  try {
    for (const city of extractCityCandidates(법정동명)) {
      const ord = await findBestOrdinance(city, "주차장 조례")
      if (!ord) continue
      const article = await findArticleByTitleOrContent(ord.ordinSeq, "부설주차장의 설치대상시설물", [
        "부설주차장",
        "설치기준",
      ])
      if (!article) continue
      const citation = articleCitation(ord.name, article)

      const annexNum = findSelfAnnexNumber(article.content)
      if (!annexNum) {
        // 조문 전체(보통 항 2~3개)를 자르지 않고 다 보여준다 — 표 행 높이는 drawInfoTable이
        // 줄바꿈 줄수에 맞춰 자동으로 늘어난다. 극단적으로 긴 조문에 대한 최소 안전장치로만
        // 800자 상한을 둔다(정상적인 부설주차장 조문은 보통 이보다 훨씬 짧음).
        const excerpt = article.content.replace(/\s+/g, " ").trim().slice(0, 800)
        return { value: `조례 자체 기준표 없음(상위법령 기준 그대로 적용): ${excerpt}`, source: citation }
      }
      const fallback: LocalStandardResult = {
        value: `[별표${annexNum}] 참조 — 세부 기준표 자동추출 실패, 원문 직접 확인 필요`,
        source: citation,
      }

      try {
        const annexes = await cached(`annexes:${ord.ordinSeq}:${ord.name}`, () => getOrdinanceAnnexList(ord.name))
        const bracketRe = new RegExp(`\\[별표\\s*${annexNum}\\]`)
        const target = annexes.find((a) => bracketRe.test(a.title))
        if (!target) return fallback

        const buffer = await downloadAnnexFile(target.fileUrl)
        const parsed = await parseAnnexFile(buffer)
        if (!parsed.success || !parsed.markdown) return fallback

        const annexSource = `${citation}, [별표${annexNum}] ${target.title.replace(/^\[별표\s*\d+\]\s*/, "")}`
        // 건축용도가 지정됐으면 해당 용도 행을 먼저 찾는다
        if (rowKeywords && rowKeywords.length > 0) {
          const useRate = extractFacilityParkingRate(parsed.markdown, rowKeywords)
          if (useRate) {
            return { value: `${rowKeywords[0]}: ${useRate}`, source: annexSource }
          }
        }
        // 용도 미지정이거나 해당 행 못 찾으면 "그 밖(기타)" 행으로 폴백
        const otherRate = extractOtherFacilityParkingRate(parsed.markdown)
        if (otherRate) {
          const label = rowKeywords && rowKeywords.length > 0 ? "해당 용도 행 못 찾음 → 그 밖(기타) 시설물" : "그 밖(기타) 시설물"
          return { value: `${label}: ${otherRate}`, source: annexSource }
        }
        // "기타" 행도 못 찾으면 표 앞부분이라도 발췌
        return { value: parsed.markdown.replace(/\s+/g, " ").trim().slice(0, 300), source: annexSource }
      } catch {
        return fallback
      }
    }
    return null
  } catch {
    return null
  }
}
