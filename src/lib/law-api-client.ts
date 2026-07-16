/**
 * 법제처 Open API — 자치법규(조례) 검색/조회 클라이언트
 * korean-law-mcp(src/lib/api-client.ts, src/lib/law-url-config.ts, src/lib/fetch-with-retry.ts)의
 * 엔드포인트·파라미터·헤더 규약을 그대로 따른다. UA/Referer가 없으면 법제처가 키가 유효해도
 * "사용자 정보 검증 실패" 에러를 주고, 클라우드 IP에서는 안티봇 JS 리다이렉트 페이지를 준다 —
 * 두 문제 모두 korean-law-mcp가 이미 겪고 고친 것이라 그 로직을 이식했다 (law-antibot.ts).
 *
 * HTTP 배관(인증/헤더/안티봇 우회)은 law-http.ts로 분리해 national-law-api-client.ts와 공유한다.
 */

import { LAW_API_BASE, getApiKey, fetchLawJson, downloadLawFile, toArray } from "./law-http.js"

export interface OrdinanceSearchResult {
  ordinSeq: string
  name: string
  agency: string
  effectiveDate: string
}

/** 자치법규(조례) 검색 — query는 "{지자체명} {조례키워드}" 형태 권장 */
export async function searchOrdinance(query: string): Promise<OrdinanceSearchResult[]> {
  const params = new URLSearchParams({
    OC: getApiKey(),
    target: "ordin",
    type: "JSON",
    query,
    display: "20",
  })
  const json = await fetchLawJson(`${LAW_API_BASE}/lawSearch.do?${params.toString()}`)
  const items = toArray(json?.OrdinSearch?.law)

  return items.map((item: any) => ({
    ordinSeq: String(item.자치법규일련번호 || ""),
    name: String(item.자치법규명 || ""),
    agency: String(item.지자체기관명 || ""),
    effectiveDate: String(item.시행일자 || ""),
  }))
}

export interface OrdinanceArticle {
  articleNo: string
  title: string
  content: string
}

/** 자치법규 전체 조문 조회 (JO 파라미터 없이 호출 — 법제처 API가 조문 전체를 한 번에 반환) */
export async function getOrdinanceArticles(ordinSeq: string): Promise<OrdinanceArticle[]> {
  const params = new URLSearchParams({
    OC: getApiKey(),
    target: "ordin",
    type: "JSON",
    MST: ordinSeq,
  })
  const json = await fetchLawJson(`${LAW_API_BASE}/lawService.do?${params.toString()}`)
  const articles = toArray(json?.LawService?.조문?.조)

  return articles.map((a: any) => ({
    articleNo: Array.isArray(a.조문번호) ? String(a.조문번호[0]) : String(a.조문번호 || ""),
    title: String(a.조제목 || ""),
    content: String(a.조내용 || ""),
  }))
}

export interface OrdinanceAnnex {
  annexNo: string
  title: string
  type: string
  fileUrl: string
}

/**
 * 자치법규 별표/서식 목록 조회 (target=ordinbyl — 조문 API와 다른 endpoint).
 * ordinanceName은 검색어라 정확한 조례명을 넣어야 해당 조례 항목만 걸러진다.
 */
export async function getOrdinanceAnnexList(ordinanceName: string): Promise<OrdinanceAnnex[]> {
  const params = new URLSearchParams({
    OC: getApiKey(),
    target: "ordinbyl",
    type: "JSON",
    query: ordinanceName,
    search: "2",
    display: "100",
  })
  const json = await fetchLawJson(`${LAW_API_BASE}/lawSearch.do?${params.toString()}`)
  const items = toArray(json?.licBylSearch?.ordinbyl)

  return items
    .map((item: any) => ({
      annexNo: String(item.별표번호 || ""),
      title: String(item.별표명 || ""),
      type: String(item.별표종류 || ""),
      fileUrl: String(item.별표서식파일링크 || item.별표서식PDF파일링크 || item.별표파일링크 || ""),
    }))
    .filter((item: any) => item.fileUrl)
}

/** 별표 파일 다운로드 (HWP/HWPX/PDF 등 바이너리) — annex-file-parser.ts로 넘겨 텍스트 추출 */
export async function downloadAnnexFile(fileUrl: string): Promise<ArrayBuffer> {
  return downloadLawFile(fileUrl)
}
