/**
 * search_national_law / get_national_law_text
 * 국가법령(법률/시행령/시행규칙)을 법제처 Open API로 직접 검색·조회한다.
 * 판례·심결례·법률용어 등은 다루지 않는다 — cadastral-mcp 파이프라인(건폐율/용적률/조경 실시간
 * 조회, national-law.ts)이 내부적으로 쓰는 것과 같은 클라이언트를 일반 질의용으로도 노출한 것.
 */

import { z } from "zod"
import { searchLaw, getLawArticles } from "../lib/national-law-api-client.js"
import { formatToolError } from "../lib/errors.js"
import type { ToolResponse } from "../lib/types.js"

export const SearchNationalLawSchema = z.object({
  query: z.string().describe("법령명 검색어 (예: 건축법 시행령, 주차장법)"),
})

export const GetNationalLawTextSchema = z.object({
  mst: z.string().describe("법령일련번호(MST) — search_national_law 결과의 MST 값"),
  jo: z
    .string()
    .optional()
    .describe("조번호 (예: '84' 또는 '제84조'). 미지정 시 전체 조문의 목차(번호+제목)만 반환"),
})

export async function searchNationalLaw(
  _apiClient: unknown,
  args: z.infer<typeof SearchNationalLawSchema>
): Promise<ToolResponse> {
  try {
    const results = await searchLaw(args.query)
    const summary = results.map((r) => ({
      법령명: r.name,
      약칭: r.shortName || undefined,
      MST: r.mst,
      법령구분: r.lawType,
      소관부처: r.ministry,
      시행일자: r.effectiveDate,
    }))
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] }
  } catch (error) {
    return formatToolError(error, "search_national_law")
  }
}

export async function getNationalLawText(
  _apiClient: unknown,
  args: z.infer<typeof GetNationalLawTextSchema>
): Promise<ToolResponse> {
  try {
    const articles = await getLawArticles(args.mst)

    if (!args.jo) {
      const toc = articles.filter((a) => a.articleNo).map((a) => ({ 조번호: a.articleNo, 조제목: a.title }))
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { 안내: "jo(조번호)를 지정해 다시 호출하면 해당 조문 전체 텍스트를 반환합니다.", 조문목차: toc },
              null,
              2
            ),
          },
        ],
      }
    }

    // "제12조의2" / "12의2" / "12-2" / "84" 등 표기가 제각각이라, 숫자만 뽑아 "12-2" 형태로
    // 표준화한 뒤 비교한다 (조문가지번호가 있는 조문은 articleNo가 "12의2"처럼 옴).
    const canonicalize = (s: string) => (s.match(/\d+/g) || []).join("-")
    const target = canonicalize(args.jo)
    const article = articles.find((a) => canonicalize(a.articleNo) === target)
    if (!article) {
      return {
        content: [{ type: "text", text: `[ERROR] 조번호 '${args.jo}'에 해당하는 조문을 찾을 수 없습니다.` }],
        isError: true,
      }
    }
    return { content: [{ type: "text", text: JSON.stringify(article, null, 2) }] }
  } catch (error) {
    return formatToolError(error, "get_national_law_text")
  }
}
