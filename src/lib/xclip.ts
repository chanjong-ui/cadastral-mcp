/**
 * AutoCAD XCLIP(SPATIAL_FILTER) 적용 — Python(ezdxf) 서브프로세스 위임
 *
 * DXF의 SPATIAL_FILTER/확장 딕셔너리는 사양이 사실상 비공식이라 raw 그룹코드를 직접
 * 작성하는 방식은 검증(round-trip)에 실패했다(ezdxf가 has_extension_dict=False로 판정).
 * 대신 검증된 오픈소스 구현체 ezdxf(mozman/ezdxf, MIT License)의 XClip API를
 * Python 서브프로세스로 호출해 파일을 후처리한다 — scripts/apply_xclip.py 참고.
 */

import { spawn } from "child_process"
import * as path from "path"
import { fileURLToPath } from "url"
import type { BBox } from "./vworld-client.js"

const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "apply_xclip.py")

export interface XclipResult {
  applied: boolean
  message: string
}

function runPython(cmd: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args)
    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", (d) => (stdout += d))
    proc.stderr.on("data", (d) => (stderr += d))
    proc.on("error", reject)
    proc.on("close", (code) => resolve({ code, stdout, stderr }))
  })
}

/**
 * filePath에 저장된 DXF 안의 blockName INSERT에 AutoCAD XCLIP을 적용한다 (파일을 제자리에서 덮어씀).
 * Python/ezdxf가 없으면 클립 없이 원본 그대로 두고, 이유가 담긴 결과를 반환한다 — 호출부는
 * 이 실패를 도구 응답에 그대로 노출해서 사용자가 원인을 알 수 있게 해야 한다.
 */
export async function applyXclip(filePath: string, blockName: string, box: BBox): Promise<XclipResult> {
  const args = [
    SCRIPT_PATH,
    filePath,
    blockName,
    String(box.minX),
    String(box.minY),
    String(box.maxX),
    String(box.maxY),
  ]

  // 시스템에 python 커맨드가 여러 개 있을 수 있고(예: python3는 있지만 ezdxf 없는 별도 설치),
  // 그중 하나만 ezdxf가 깔려있는 경우가 있어 exit code 실패도 다음 후보로 계속 넘어간다.
  // ENOENT(커맨드 자체 없음)든 ModuleNotFoundError든 전부 후보를 다 시도해보고 마지막 실패를 보고한다.
  // CADASTRAL_PYTHON 환경변수를 설정하면 자동탐지보다 그 경로를 최우선으로 시도한다.
  let lastFailure: string | null = null
  const candidates = process.env.CADASTRAL_PYTHON
    ? [process.env.CADASTRAL_PYTHON, "python3", "python", "py"]
    : ["python3", "python", "py"]

  for (const cmd of candidates) {
    let result: { code: number | null; stdout: string; stderr: string }
    try {
      result = await runPython(cmd, args)
    } catch (error: any) {
      if (error?.code === "ENOENT") continue // 이 커맨드 자체가 없음 — 다음 후보 시도
      lastFailure = `XCLIP 적용 실패: ${error.message}`
      continue
    }

    if (result.code === 0) {
      return { applied: true, message: result.stdout.trim() }
    }
    lastFailure = `XCLIP 적용 실패 (${cmd} 종료코드 ${result.code}): ${result.stderr.trim() || result.stdout.trim()}`
  }

  return {
    applied: false,
    message:
      lastFailure ||
      "Python을 찾을 수 없어 XCLIP을 적용하지 못했습니다. 지적도는 블록 안에 잘리지 않은 상태로 남아있습니다. " +
        "Python 3 설치 및 `pip install ezdxf` 후 다시 시도하세요.",
  }
}
