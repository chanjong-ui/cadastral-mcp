import type { ToolResponse } from "./types.js"

/**
 * 에러 메시지/URL에 섞여 들어올 수 있는 VWORLD_KEY 쿼리파라미터를 마스킹.
 * fetch 실패 시 원본 URL이 Error.message에 그대로 담기는 경우가 있어 최종 방어선으로 둔다.
 */
export function maskSensitiveUrl(text: string): string {
  return text.replace(/([?&]key=)[^&\s]+/gi, "$1***")
}

export class CadastralApiError extends Error {
  suggestions: string[]

  constructor(message: string, suggestions: string[] = []) {
    super(message)
    this.name = "CadastralApiError"
    this.suggestions = suggestions
  }
}

export function formatToolError(error: unknown, context?: string): ToolResponse {
  let msg: string
  let suggestions: string[] = []

  if (error instanceof CadastralApiError) {
    msg = error.message
    suggestions = error.suggestions
  } else if (error instanceof Error) {
    msg = error.message
  } else {
    msg = String(error)
  }

  const lines = [`[ERROR] ${maskSensitiveUrl(msg)}`]
  if (context) lines.push(`도구: ${context}`)
  if (suggestions.length > 0) {
    lines.push("제안:")
    suggestions.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`))
  }

  return { content: [{ type: "text", text: lines.join("\n") }], isError: true }
}
