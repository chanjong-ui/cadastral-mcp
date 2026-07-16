/**
 * 법제처 Open API 공통 HTTP 배관 — 자치법규 클라이언트(law-api-client.ts)와
 * 국가법령 클라이언트(national-law-api-client.ts)가 함께 쓴다.
 * 엔드포인트(target=ordin/law 등)만 다르고 인증·헤더·안티봇 우회는 완전히 동일하다.
 */

import { followLawAntibot } from "./law-antibot.js"

export const LAW_API_BASE = "https://www.law.go.kr/DRF"
export const LAW_SITE_BASE = "https://www.law.go.kr"
const REQUEST_TIMEOUT_MS = 10000
const DOWNLOAD_TIMEOUT_MS = 30000

const USER_AGENT =
  process.env.LAW_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
const REFERER = process.env.LAW_REFERER || "https://www.law.go.kr/"

export function getApiKey(): string {
  const key = process.env.LAW_OC
  if (!key) {
    throw new Error(
      "LAW_OC 환경변수가 설정되지 않았습니다. https://open.law.go.kr/LSO/openApi/guideResult.do 에서 발급받으세요."
    )
  }
  return key
}

export async function fetchLawJson(url: string): Promise<any> {
  const headers = new Headers({ "user-agent": USER_AGENT, referer: REFERER })
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url, { headers, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }

  // 클라우드 IP 안티봇 JS 리다이렉트 우회 (로컬/등록 IP에서는 no-op)
  try {
    const bypassed = await followLawAntibot(response, url, headers, REQUEST_TIMEOUT_MS)
    if (bypassed) response = bypassed
  } catch {
    /* 우회 실패 시 원본 응답으로 진행 */
  }

  const text = await response.text()
  const trimmed = text.trim()
  if (!trimmed) throw new Error("법제처 API가 빈 응답을 반환했습니다")
  if (/^<!doctype html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    throw new Error("법제처 API가 HTML 페이지를 반환했습니다 (안티봇 우회 실패 또는 파라미터 오류)")
  }

  try {
    return JSON.parse(text)
  } catch (e: any) {
    throw new Error(`법제처 API 응답 JSON 파싱 실패: ${e.message}`)
  }
}

/** 별표/서식 등 바이너리 파일 다운로드(HWP/HWPX/PDF) — 안티봇 우회 포함 */
export async function downloadLawFile(fileUrl: string): Promise<ArrayBuffer> {
  const url = fileUrl.startsWith("http") ? fileUrl : `${LAW_SITE_BASE}${fileUrl}`
  const headers = new Headers({ "user-agent": USER_AGENT, referer: REFERER })
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url, { headers, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }

  try {
    const bypassed = await followLawAntibot(response, url, headers, DOWNLOAD_TIMEOUT_MS)
    if (bypassed) response = bypassed
  } catch {
    /* 우회 실패 시 원본 응답으로 진행 */
  }

  if (!response.ok) {
    throw new Error(`파일 다운로드 실패: HTTP ${response.status}`)
  }
  return response.arrayBuffer()
}

export function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}
