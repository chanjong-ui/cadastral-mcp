/**
 * 법제처 Open API — 국가법령(법률/시행령/시행규칙) 검색/조회 클라이언트.
 * law-api-client.ts(자치법규 전용)와 HTTP 배관(law-http.ts)은 공유하지만, target=law 응답의
 * JSON 모양이 조례(target=ordin)와 다르다:
 *   - 조례: 조문 하나가 조내용(문자열 하나)에 항·호·목까지 다 이어붙여진 채로 온다.
 *   - 국가법령: 조문이 항[]→호[]→목[] 구조로 정확히 쪼개져서 온다(조문내용은 "제84조(...)" 표제뿐).
 * 그래서 이 파일은 그 구조를 조례와 같은 "평탄한 한 문자열" 모양(OrdinanceArticle과 동일한
 * {articleNo, title, content})으로 합쳐서 반환한다 — 그러면 local-ordinance.ts의
 * extractZonePercent/extractFirstParagraph를 국가법령 조문에도 그대로 재사용할 수 있다
 * (실제로 항①의 호 목록이 "1.  제1종전용주거지역 : 50퍼센트 이하2.  제2종전용주거지역 : ..."
 * 형태로 이어붙게 되는데, 이는 조례 원문과 같은 패턴이라 기존 파서가 그대로 통한다).
 */

import { LAW_API_BASE, getApiKey, fetchLawJson, toArray } from "./law-http.js"

export interface LawSearchResult {
  lawId: string
  mst: string
  name: string
  shortName: string
  lawType: string
  ministry: string
  effectiveDate: string
}

/** 국가법령 검색 — query는 법령명(예: "국토의 계획 및 이용에 관한 법률 시행령") */
export async function searchLaw(query: string): Promise<LawSearchResult[]> {
  const params = new URLSearchParams({
    OC: getApiKey(),
    target: "law",
    type: "JSON",
    query,
    display: "20",
  })
  const json = await fetchLawJson(`${LAW_API_BASE}/lawSearch.do?${params.toString()}`)
  const items = toArray(json?.LawSearch?.law)

  return items.map((item: any) => ({
    lawId: String(item.법령ID || ""),
    mst: String(item.법령일련번호 || ""),
    name: String(item.법령명한글 || ""),
    shortName: String(item.법령약칭명 || ""),
    lawType: String(item.법령구분명 || ""),
    ministry: String(item.소관부처명 || ""),
    effectiveDate: String(item.시행일자 || ""),
  }))
}

export interface LawArticle {
  articleNo: string
  title: string
  content: string
}

/** 중첩된 문자열/문자열배열(항내용·호내용·목내용에서 흔함)을 하나의 평탄한 문자열로 이어붙인다 */
export function flattenText(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(flattenText).join("")
  return ""
}

/** 조문단위 하나(항→호→목 구조)를 OrdinanceArticle과 같은 평탄한 문자열로 합친다 */
export function flattenArticleUnit(unit: any): LawArticle {
  const parts: string[] = [flattenText(unit.조문내용)]
  for (const hang of toArray(unit.항)) {
    parts.push(flattenText(hang.항내용))
    for (const ho of toArray(hang.호)) {
      parts.push(flattenText(ho.호내용))
      for (const mok of toArray(ho.목)) {
        parts.push(flattenText(mok.목내용))
      }
    }
  }
  // 조문가지번호가 있으면(예: 제12조의2) 붙여준다 — 없으면 base 조문번호("12")와
  // 구분이 안 돼 목차에 같은 번호가 여러 개 있는 것처럼 보인다(실사용 중 발견).
  const base = String(unit.조문번호 || "")
  const branch = unit.조문가지번호 ? String(unit.조문가지번호) : ""
  return {
    articleNo: branch ? `${base}의${branch}` : base,
    title: String(unit.조문제목 || ""),
    content: parts.join(""),
  }
}

/**
 * 국가법령 전체 조문 조회. 법제처 API도 조례처럼 JO 없이 MST만으로 조문 전체를 반환하므로,
 * 특정 조문 찾기는 (조례와 동일하게) 응답을 다 받은 뒤 이 함수 호출부에서 골라내는 방식으로 한다.
 */
export async function getLawArticles(mst: string): Promise<LawArticle[]> {
  const params = new URLSearchParams({
    OC: getApiKey(),
    target: "law",
    type: "JSON",
    MST: mst,
  })
  const json = await fetchLawJson(`${LAW_API_BASE}/lawService.do?${params.toString()}`)
  const units = toArray(json?.법령?.조문?.조문단위).filter((u: any) => u.조문여부 === "조문")

  return units.map(flattenArticleUnit)
}
