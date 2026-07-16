import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import type { ToolResponse } from "./lib/types.js"
import { formatToolError } from "./lib/errors.js"
import {
  getLandUsePlan,
  GetLandUsePlanSchema,
  getLandUsePlanByPnu,
  GetLandUsePlanByPnuSchema,
} from "./tools/land-use-plan.js"
import {
  exportCadastralDxf,
  ExportCadastralDxfSchema,
  exportCadastralDxfByPnu,
  ExportCadastralDxfByPnuSchema,
} from "./tools/cadastral-dxf.js"
import {
  exportLandReportDxf,
  ExportLandReportDxfSchema,
  exportLandReportDxfByPnu,
  ExportLandReportDxfByPnuSchema,
} from "./tools/land-report-dxf.js"
import {
  searchNationalLaw,
  SearchNationalLawSchema,
  getNationalLawText,
  GetNationalLawTextSchema,
} from "./tools/national-law.js"

export interface McpTool {
  name: string
  description: string
  schema: z.ZodType
  handler: (apiClient: unknown, args: any) => Promise<ToolResponse>
}

export const allTools: McpTool[] = [
  {
    name: "get_land_use_plan",
    description: "[토지이용계획] 지번 주소로 토지대장·용도지역지구·개별공시지가 통합 조회.",
    schema: GetLandUsePlanSchema,
    handler: getLandUsePlan,
  },
  {
    name: "get_land_use_plan_by_pnu",
    description: "[토지이용계획] PNU(19자리)로 토지대장·용도지역지구·개별공시지가 통합 조회.",
    schema: GetLandUsePlanByPnuSchema,
    handler: getLandUsePlanByPnu,
  },
  {
    name: "export_cadastral_dxf",
    description:
      "[지적도] 지번 주소로 필지 경계를 DXF 파일로 내보내기 (연속지적도 기반, 참고용). " +
      "범위(bufferMeters) 미지정 시 먼저 물어볼 것. 기본 50m.",
    schema: ExportCadastralDxfSchema,
    handler: exportCadastralDxf,
  },
  {
    name: "export_cadastral_dxf_by_pnu",
    description:
      "[지적도] PNU(19자리)로 필지 경계를 DXF 파일로 내보내기 (연속지적도 기반, 참고용). " +
      "범위(bufferMeters) 미지정 시 먼저 물어볼 것. 기본 50m.",
    schema: ExportCadastralDxfByPnuSchema,
    handler: exportCadastralDxfByPnu,
  },
  {
    name: "export_land_report_dxf",
    description:
      "[통합리포트] 지번 주소로 요청정보+토지이용계획+지적도를 한 페이지 DXF로 내보내기 " +
      "(좌: 요청정보 / 우상단: 토지이용계획 / 우하단: 지적도). " +
      "범위(bufferMeters) 미지정 시 먼저 물어볼 것. 기본 50m.",
    schema: ExportLandReportDxfSchema,
    handler: exportLandReportDxf,
  },
  {
    name: "export_land_report_dxf_by_pnu",
    description:
      "[통합리포트] PNU(19자리)로 요청정보+토지이용계획+지적도를 한 페이지 DXF로 내보내기 " +
      "(좌: 요청정보 / 우상단: 토지이용계획 / 우하단: 지적도). " +
      "범위(bufferMeters) 미지정 시 먼저 물어볼 것. 기본 50m.",
    schema: ExportLandReportDxfByPnuSchema,
    handler: exportLandReportDxfByPnu,
  },
  {
    name: "search_national_law",
    description: "[국가법령] 법령명으로 검색 (법률/시행령/시행규칙). 판례·법률용어 등은 다루지 않음.",
    schema: SearchNationalLawSchema,
    handler: searchNationalLaw,
  },
  {
    name: "get_national_law_text",
    description:
      "[국가법령] MST로 조문 조회. jo(조번호) 미지정 시 조문 목차만, 지정 시 해당 조문 전체 텍스트 반환.",
    schema: GetNationalLawTextSchema,
    handler: getNationalLawText,
  },
]

function toMcpInputSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, { io: "input" }) as any
}

const SERVICE_NAME = "Cadastral-mcp"
const toolMap = new Map<string, McpTool>(allTools.map((tool) => [tool.name, tool]))

export function registerTools(server: Server) {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools.map((tool) => ({
      name: tool.name,
      description: `${SERVICE_NAME} — ${tool.description}`,
      inputSchema: toMcpInputSchema(tool.schema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    const tool = toolMap.get(name)
    if (!tool) return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true }
    try {
      const input = tool.schema.parse(args)
      const result = await tool.handler(null, input)
      return { content: result.content.map((c) => ({ type: "text", text: c.text })), isError: result.isError }
    } catch (error) {
      const errResult = formatToolError(error, name)
      return { content: errResult.content.map((c) => ({ type: "text", text: c.text })), isError: true }
    }
  })
}
