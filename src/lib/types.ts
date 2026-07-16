export interface ToolResponse {
  content: { type: "text"; text: string }[]
  isError?: boolean
}
