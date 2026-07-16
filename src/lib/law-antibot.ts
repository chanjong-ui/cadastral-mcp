/**
 * law.go.kr JS 안티봇 우회 (클라우드 IP 대응)
 * korean-law-mcp(src/lib/law-antibot.ts)에서 그대로 이식 — 원본 주석/로직 유지.
 *
 * 법제처는 클라우드 IP(GCP/AWS/Fly 등)에서 온 요청에 API 데이터 대신
 * `location.assign(...)` JS 리다이렉트 페이지를 반환할 때가 있다. 이 페이지의
 * 난독화된 URL을 파싱해 토큰 URL로 재요청하면 우회된다.
 */

export function parseAntibotUrl(html: string): string | null {
  const a = html.match(/t:'([^']*)',h:'([^']*)'/)
  if (a) {
    const o = html.match(/o:'([^']*)'/)
    if (o) return a[1] + a[2] + o[1]
  }

  const b = html.match(/o:'([^']*)',c:(\d+)},z=(\d+)/)
  if (b) {
    const o = b[1]
    const c = Number(b[2])
    const z = Number(b[3])
    return o.slice(0, c) + o.slice(c + z)
  }

  return null
}

async function fetchOnce(url: string, headers: Headers, timeout: number): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  try {
    return await fetch(url, { headers, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * 응답이 JS 안티봇 페이지면 우회한 새 Response를, 아니면 null(원본 유지)을 반환.
 */
export async function followLawAntibot(
  response: Response,
  originalUrl: string,
  headers: Headers,
  timeout: number,
  maxHops = 3
): Promise<Response | null> {
  let current = response
  let hopped = false

  for (let hop = 0; hop < maxHops; hop++) {
    let text: string
    try {
      text = await current.clone().text()
    } catch {
      return hopped ? current : null
    }

    if (!text.includes("location.assign")) {
      return hopped ? current : null
    }

    const path = parseAntibotUrl(text)
    if (!path) return hopped ? current : null

    let nextUrl: string
    try {
      nextUrl = new URL(path, originalUrl).toString()
    } catch {
      return hopped ? current : null
    }

    const next = await fetchOnce(nextUrl, headers, timeout)
    hopped = true

    if (next.status === 404) {
      return await fetchOnce(originalUrl, headers, timeout)
    }

    current = next
  }

  return current
}
