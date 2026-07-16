#!/usr/bin/env node

/**
 * Cadastral MCP Server
 * 브이월드(국토교통부) API 기반 토지이용계획·지적도 MCP 서버
 */

import "./lib/load-env.js"

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { registerTools } from "./tool-registry.js"
import { VERSION } from "./version.js"

function createServer(): Server {
  const server = new Server(
    { name: "cadastral-mcp", version: VERSION },
    { capabilities: { tools: {} } }
  )
  registerTools(server)
  return server
}

async function main() {
  // stdout 오염 방지: MCP JSON-RPC 프로토콜 보호
  const stderrWrite = (...args: unknown[]) => process.stderr.write(args.map(String).join(" ") + "\n")
  console.log = console.warn = console.info = console.debug = stderrWrite

  const server = createServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error) => {
  console.error("Server error:", error)
  process.exit(1)
})
