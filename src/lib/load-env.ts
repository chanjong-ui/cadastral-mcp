/**
 * .env 로딩 전용 leaf 모듈.
 * ES 모듈은 import 선언을 소스 순서와 무관하게 먼저 전부 평가하므로,
 * index.ts에 dotenv 호출을 직접 섞어 쓰면 tool-registry -> vworld-client 쪽
 * 모듈 top-level의 process.env 참조가 dotenv 로딩보다 먼저 실행돼버린다.
 * 다른 프로젝트 모듈을 import하지 않는 이 파일을 index.ts의 첫 import로 두면
 * 나머지 import보다 먼저 완전히 평가되어 순서가 보장된다.
 *
 * 경로를 지정하지 않으면 dotenv는 process.cwd() 기준으로 .env를 찾는데, MCP
 * 클라이언트(Hermes/Claude Desktop 등)는 보통 이 프로젝트 폴더가 아닌 자기
 * 자신의 작업 디렉터리에서 `node build/index.js`를 실행한다 — 그러면 .env를
 * 못 찾아 모든 도구 호출이 "환경변수가 설정되지 않았습니다"로 실패한다(실사용
 * 중 발견). 그래서 실행 위치와 무관하게 항상 이 스크립트 자신의 위치 기준으로
 * 프로젝트 루트의 .env를 찾도록 절대경로를 명시한다.
 */
import { config } from "dotenv"
import { fileURLToPath } from "url"
import * as path from "path"

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, "..", "..") // build/lib/load-env.js -> 프로젝트 루트

config({ path: path.join(projectRoot, ".env"), quiet: true })
