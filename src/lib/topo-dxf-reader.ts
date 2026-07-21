/**
 * 국토지리정보원 수치지형도(V1.0 DXF) 리더.
 * 사용자가 map.ngii.go.kr에서 무상 다운로드한 수치지형도 DXF를 읽어, 국토지리정보원 표준
 * 레이어 코드(연속수치지형도 코드 및 레이어 설명서 Ver 5.1.1 기준)로 분류해 반환한다.
 *
 * 레이어명 규칙: 8자리 통합코드의 앞글자가 분류 — A교통 B건물 C시설 D식생 E수계 F지형 G경계 H주기.
 * 실제 파일에서는 "N1L_F0010000" 형태 또는 "F0017111"처럼 8자리 코드만 쓰기도 하므로,
 * 레이어명 안에 포함된 8자리 코드(정규식)로 분류한다.
 *
 * 인코딩: 수치지형도 DXF는 CP949(한글)다. 그러나 병합에 필요한 도형 좌표·레이어코드·표고값은
 * 전부 ASCII라, 바이트 보존형 latin1으로 읽어 구조를 파싱해도 안전하다(한글 TEXT 라벨만
 * 깨지는데, 도면 병합에는 지형 도형이 핵심이라 라벨은 선택적으로만 쓴다).
 *
 * 대용량(수십 MB, 100만+ 라인)이라 라인 배열 파싱은 메모리를 쓰지만, 개인 PC에서 도엽 1장
 * 처리에는 충분하다. 스트리밍이 필요하면 후속 과제로 남긴다.
 */

import * as fs from "fs"

/** 표준 분류: 8자리 코드 접두로 판정 */
export type TopoCategory =
  | "등고선"
  | "표고점"
  | "건물"
  | "도로중심선"
  | "도로경계"
  | "하천중심선"
  | "실폭하천"
  | "기타지형"
  | "기타"

export interface TopoEntity {
  category: TopoCategory
  layerCode: string // 8자리 통합코드 (예: F0010000, F0017111)
  layerName: string // 원본 레이어명 전체
  type: string // LWPOLYLINE | POLYLINE | LINE | POINT | TEXT
  /** XY 좌표열 (EPSG:5186 등 투영좌표, 원본 그대로) */
  points: [number, number][]
  /** 표고값(m) — 등고선(LWPOLYLINE elevation, group 38)·표고점(POINT의 Z, group 30) */
  elevation?: number
  /** TEXT 엔티티의 문자열(표고 숫자 등). CP949라 한글은 깨질 수 있음 */
  text?: string
}

/** 8자리 코드 → 표준 분류 판정 */
export function categorize(code: string): TopoCategory {
  if (code.startsWith("F001")) return "등고선"
  if (code.startsWith("F002")) return "표고점"
  if (code.startsWith("B001")) return "건물"
  if (code.startsWith("A002")) return "도로중심선"
  if (code.startsWith("A001")) return "도로경계"
  if (code.startsWith("E002")) return "하천중심선"
  if (code.startsWith("E003")) return "실폭하천"
  if (code.startsWith("F")) return "기타지형"
  return "기타"
}

/** 레이어명에서 8자리 통합코드(영문1자+숫자7자)를 추출. 없으면 원본 반환 */
export function extractLayerCode(layerName: string): string {
  const m = layerName.match(/[A-H]\d{7}/)
  return m ? m[0] : layerName
}

interface Pair {
  code: string
  value: string
}

/** ENTITIES 섹션의 (그룹코드, 값) 페어 시퀀스를 엔티티 단위로 끊어 파싱 */
function parseEntities(pairs: Pair[]): TopoEntity[] {
  const entities: TopoEntity[] = []

  let curType: string | null = null
  let curLayer = ""
  let points: [number, number][] = []
  let pendingX: number | null = null
  let elevation: number | undefined
  let text: string | undefined
  let z: number | undefined

  const flush = () => {
    if (!curType) return
    // LINE은 시작점만 group10/20, 끝점은 11/21 — 아래 루프에서 별도 수집됨
    if (points.length === 0 && z === undefined) {
      curType = null
      return
    }
    const layerCode = extractLayerCode(curLayer)
    // 표고점(POINT)은 z가 표고, 등고선(LWPOLYLINE)은 elevation(group38)이 표고
    const elev = elevation ?? z
    entities.push({
      category: categorize(layerCode),
      layerCode,
      layerName: curLayer,
      type: curType,
      points: points.slice(),
      elevation: elev,
      text,
    })
  }

  for (const { code, value } of pairs) {
    if (code === "0") {
      flush()
      curType = value.trim()
      curLayer = ""
      points = []
      pendingX = null
      elevation = undefined
      text = undefined
      z = undefined
      continue
    }
    if (!curType) continue

    switch (code) {
      case "8":
        curLayer = value.trim()
        break
      case "10": {
        const x = Number(value)
        if (!Number.isNaN(x)) pendingX = x
        break
      }
      case "20": {
        const y = Number(value)
        if (!Number.isNaN(y) && pendingX !== null) {
          points.push([pendingX, y])
          pendingX = null
        }
        break
      }
      case "30": {
        const zz = Number(value)
        if (!Number.isNaN(zz)) z = zz
        break
      }
      case "38": {
        // LWPOLYLINE elevation
        const e = Number(value)
        if (!Number.isNaN(e)) elevation = e
        break
      }
      case "1":
        text = value.trim()
        break
    }
  }
  flush()
  return entities
}

/**
 * 수치지형도 DXF 파일을 읽어 표준 분류된 엔티티 목록을 반환한다.
 * @param filePath 다운로드한 수치지형도 DXF 경로
 */
export function readTopoDxf(filePath: string): TopoEntity[] {
  // 바이트 보존형 latin1로 읽음 — 좌표/코드/숫자는 ASCII라 안전, 한글 라벨만 깨짐(병합엔 무관)
  const raw = fs.readFileSync(filePath, "latin1")
  const lines = raw.split(/\r\n|\r|\n/)

  const pairs: Pair[] = []
  for (let i = 0; i + 1 < lines.length; i += 2) {
    pairs.push({ code: lines[i].trim(), value: lines[i + 1] })
  }
  return parseEntities(pairs)
}

export interface TopoBBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * 엔티티를 경계상자(대상 필지 버퍼)로 클립한다. 폴리라인을 정점 단위로 자르지 않고,
 * "정점이 하나라도 bbox 안에 있으면 통째로 유지"하는 방식 — 등고선/건물이 경계에서
 * 잘려 반쪽만 남으면 오히려 도면이 이상해지므로, 실무에서 흔히 쓰는 "걸치는 것은 살린다"
 * 규칙을 따른다. (정밀 클립이 필요하면 후속 과제)
 */
export function clipTopoEntities(entities: TopoEntity[], bbox: TopoBBox): TopoEntity[] {
  return entities.filter((e) => {
    if (e.category === "기타") return false // 도곽선·블록로컬 등 잡엔티티 제외
    return e.points.some(([x, y]) => x >= bbox.minX && x <= bbox.maxX && y >= bbox.minY && y <= bbox.maxY)
  })
}

export interface TopoSummary {
  total: number
  byCategory: Record<string, { count: number; codes: Set<string> }>
  extent: { minX: number; minY: number; maxX: number; maxY: number } | null
  elevationRange: { min: number; max: number } | null
}

/** 읽어들인 엔티티의 요약(분류별 개수·좌표범위·표고범위) — 진단/검증용 */
export function summarizeTopo(entities: TopoEntity[]): TopoSummary {
  const byCategory: TopoSummary["byCategory"] = {}
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  let hasCoord = false
  let minE = Infinity,
    maxE = -Infinity
  let hasElev = false

  for (const e of entities) {
    if (!byCategory[e.category]) byCategory[e.category] = { count: 0, codes: new Set() }
    byCategory[e.category].count++
    byCategory[e.category].codes.add(e.layerCode)

    for (const [x, y] of e.points) {
      // 블록-로컬 좌표(원점 근처) 제외 위해 실좌표만
      if (x > 1000 && y > 1000) {
        hasCoord = true
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    if (e.elevation !== undefined && Math.abs(e.elevation) > 0.01) {
      hasElev = true
      if (e.elevation < minE) minE = e.elevation
      if (e.elevation > maxE) maxE = e.elevation
    }
  }

  return {
    total: entities.length,
    byCategory,
    extent: hasCoord ? { minX, minY, maxX, maxY } : null,
    elevationRange: hasElev ? { min: minE, max: maxE } : null,
  }
}
