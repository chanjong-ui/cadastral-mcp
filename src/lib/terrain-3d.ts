/**
 * 3D 대지 모델 생성 — 수치지형도 등고선/표고점으로 지형 TIN을 만들고,
 * VWorld 건물 폴리곤 + 지상층수로 건물을 extrude해 3D DXF(3DFACE 메쉬)로 출력한다.
 *
 * 지형: 실측 등고선 정점(각 정점에 그 등고선의 표고 부여) + 표고점(x,y,z)을 점군으로 모아
 * Delaunay 삼각분할 → 3DFACE 삼각형 메쉬. (STURA3D식 90m DEM보다 정확 — 실측 데이터 사용)
 * 건물: 층수 × 층고(기본 3.3m)로 높이 추정 → 벽면 4각 3DFACE + 지붕 삼각분할 3DFACE.
 *       바닥 표고는 건물 위치의 지형 TIN 값을 샘플링해 지형에 얹는다.
 */

import Delaunator from "delaunator"
import polygonClipping from "polygon-clipping"
import earcut from "earcut"
import { DxfWriter, point3d } from "@tarikjabiri/dxf"
import type { ParcelGeometry, BuildingFootprint, BBox } from "./vworld-client.js"
import type { TopoEntity } from "./topo-dxf-reader.js"

const L_TERRAIN = "지형_TIN"
const L_BUILDING = "건물_매스"
const L_PARCEL = "지적_대상필지"
const L_ROAD_SURFACE = "도로_면"
const L_ROAD_EDGE = "도로_가장자리"
const L_RIVER_SURFACE = "하천_면"

export type Pt3 = [number, number, number]

/** 등고선 정점(등고선 표고 부여) + 표고점을 3D 점군으로 수집 */
export function collectElevationPoints(entities: TopoEntity[]): Pt3[] {
  const pts: Pt3[] = []
  for (const e of entities) {
    if (e.elevation === undefined || Math.abs(e.elevation) < 0.001) continue
    if (e.category === "등고선") {
      for (const [x, y] of e.points) pts.push([x, y, e.elevation])
    } else if (e.category === "표고점") {
      const p = e.points[0]
      if (p) pts.push([p[0], p[1], e.elevation])
    }
  }
  return pts
}

export interface Tin {
  points: Pt3[]
  triangles: Uint32Array // 3개씩 정점 인덱스
  index?: TinIndex // 공간 인덱스 (sampleElevation 가속용, buildTin이 자동 생성)
}

/**
 * TIN 삼각형 공간 인덱스 — 균일 격자 버킷. 각 셀에 그 셀과 겹치는 삼각형 인덱스(i/3)를 담아,
 * sampleElevation이 전체 삼각형이 아니라 해당 셀의 후보만 검사하게 한다(선형→상수 시간).
 */
interface TinIndex {
  minX: number
  minY: number
  cell: number
  nx: number
  ny: number
  buckets: number[][] // [iy*nx+ix] = 삼각형 시작인덱스(i, triangles의 3배수) 목록
}

function buildTinIndex(tin: Tin): TinIndex | null {
  const { points, triangles } = tin
  if (triangles.length === 0) return null
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const p of points) {
    if (p[0] < minX) minX = p[0]
    if (p[0] > maxX) maxX = p[0]
    if (p[1] < minY) minY = p[1]
    if (p[1] > maxY) maxY = p[1]
  }
  const triCount = triangles.length / 3
  // 셀 하나에 삼각형 몇 개 정도 되도록 셀 크기 산정
  const area = Math.max(1, (maxX - minX) * (maxY - minY))
  const cell = Math.max(1, Math.sqrt(area / Math.max(1, triCount)))
  const nx = Math.max(1, Math.ceil((maxX - minX) / cell) + 1)
  const ny = Math.max(1, Math.ceil((maxY - minY) / cell) + 1)
  const buckets: number[][] = new Array(nx * ny)
  const cx = (v: number) => Math.min(nx - 1, Math.max(0, Math.floor((v - minX) / cell)))
  const cy = (v: number) => Math.min(ny - 1, Math.max(0, Math.floor((v - minY) / cell)))
  for (let i = 0; i < triangles.length; i += 3) {
    const a = points[triangles[i]]
    const b = points[triangles[i + 1]]
    const c = points[triangles[i + 2]]
    const ix0 = cx(Math.min(a[0], b[0], c[0]))
    const ix1 = cx(Math.max(a[0], b[0], c[0]))
    const iy0 = cy(Math.min(a[1], b[1], c[1]))
    const iy1 = cy(Math.max(a[1], b[1], c[1]))
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const k = iy * nx + ix
        ;(buckets[k] ||= []).push(i)
      }
    }
  }
  return { minX, minY, cell, nx, ny, buckets }
}

/** 2D Delaunay 삼각분할로 TIN 생성 (Z는 입력 점 표고 유지) + 공간 인덱스 자동 부착 */
export function buildTin(points: Pt3[]): Tin {
  if (points.length < 3) return { points, triangles: new Uint32Array(0) }
  const d = Delaunator.from(points.map((p) => [p[0], p[1]]))
  const tin: Tin = { points, triangles: d.triangles }
  tin.index = buildTinIndex(tin) ?? undefined
  return tin
}

function triArea2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
}

function baryZ(tin: Tin, i: number, x: number, y: number): number | null {
  const { points, triangles } = tin
  const a = points[triangles[i]]
  const b = points[triangles[i + 1]]
  const c = points[triangles[i + 2]]
  const area = triArea2(a[0], a[1], b[0], b[1], c[0], c[1])
  if (Math.abs(area) < 1e-9) return null
  const w0 = triArea2(x, y, b[0], b[1], c[0], c[1]) / area
  const w1 = triArea2(a[0], a[1], x, y, c[0], c[1]) / area
  const w2 = 1 - w0 - w1
  if (w0 >= -0.001 && w1 >= -0.001 && w2 >= -0.001) return w0 * a[2] + w1 * b[2] + w2 * c[2]
  return null
}

/**
 * TIN에서 (x,y) 표고를 무게중심 보간해 반환. index가 있으면 해당 셀 후보만 검사(빠름),
 * 없으면 전체 삼각형 선형 검사. 어느 삼각형에도 안 들면 최근접 점 표고로 폴백.
 */
export function sampleElevation(tin: Tin, x: number, y: number, indexArg?: TinIndex | null): number | null {
  const { points, triangles } = tin
  if (points.length === 0) return null
  const index = indexArg ?? tin.index

  if (index) {
    const ix = Math.min(index.nx - 1, Math.max(0, Math.floor((x - index.minX) / index.cell)))
    const iy = Math.min(index.ny - 1, Math.max(0, Math.floor((y - index.minY) / index.cell)))
    const cand = index.buckets[iy * index.nx + ix]
    if (cand) {
      for (const i of cand) {
        const z = baryZ(tin, i, x, y)
        if (z !== null) return z
      }
    }
  } else {
    for (let i = 0; i < triangles.length; i += 3) {
      const z = baryZ(tin, i, x, y)
      if (z !== null) return z
    }
  }

  // 폴백: 최근접 점
  let best = points[0]
  let bestD = Infinity
  for (const p of points) {
    const dd = (p[0] - x) ** 2 + (p[1] - y) ** 2
    if (dd < bestD) {
      bestD = dd
      best = p
    }
  }
  return best[2]
}

export interface TerrainGrid {
  minX: number
  minY: number
  cell: number // 격자 간격(m)
  nx: number // X방향 격자점 수
  ny: number
  z: (number | null)[][] // [ix][iy] 격자점 표고 (범위 밖이면 null)
}

/**
 * topoROK 방식(격자 재샘플링): TIN을 규칙적인 격자로 다시 뽑아 매끄러운 표면을 만든다.
 * topoROK는 격자점에서 위로 광선을 쏴 메쉬 교점 Z를 얻는데, 우리는 이미 TIN 무게중심 보간
 * 샘플러(sampleElevation)가 있으므로 각 격자점을 그걸로 샘플링한다(동일한 결과, 더 간단).
 * cell(격자 간격)이 작을수록 매끄럽지만 면이 많아진다. bbox 범위만 만든다.
 */
export function resampleToGrid(tin: Tin, bbox: BBox, cell: number): TerrainGrid {
  const nx = Math.max(1, Math.ceil((bbox.maxX - bbox.minX) / cell))
  const ny = Math.max(1, Math.ceil((bbox.maxY - bbox.minY) / cell))
  const z: (number | null)[][] = []
  for (let ix = 0; ix <= nx; ix++) {
    const col: (number | null)[] = []
    const x = bbox.minX + ix * cell
    for (let iy = 0; iy <= ny; iy++) {
      const y = bbox.minY + iy * cell
      col.push(sampleElevation(tin, x, y))
    }
    z.push(col)
  }
  return { minX: bbox.minX, minY: bbox.minY, cell, nx, ny, z }
}

function ringCentroid(ring: number[][]): [number, number] {
  let sx = 0,
    sy = 0
  for (const [x, y] of ring) {
    sx += x
    sy += y
  }
  return [sx / ring.length, sy / ring.length]
}

function isClosedRing(pts: [number, number][]): boolean {
  if (pts.length < 4) return false
  const f = pts[0]
  const l = pts[pts.length - 1]
  return Math.abs(f[0] - l[0]) < 0.01 && Math.abs(f[1] - l[1]) < 0.01
}

/** 닫힌 폴리곤(도로 면·강 면)을 지형에 드레이프 — 중심 부채꼴 삼각분할, 각 정점 표고는 지형 샘플 */
function drapePolygon(dxf: DxfWriter, pts: [number, number][], tin: Tin, layer: string) {
  const [cx, cy] = ringCentroid(pts)
  const cz = (sampleElevation(tin, cx, cy) ?? 0) + 0.05
  for (let k = 0; k < pts.length - 1; k++) {
    const [x1, y1] = pts[k]
    const [x2, y2] = pts[k + 1]
    const z1 = (sampleElevation(tin, x1, y1) ?? 0) + 0.05
    const z2 = (sampleElevation(tin, x2, y2) ?? 0) + 0.05
    dxf.add3dFace(point3d(cx, cy, cz), point3d(x1, y1, z1), point3d(x2, y2, z2), point3d(x2, y2, z2), {
      layerName: layer,
    })
  }
}

/** 열린 선(도로 가장자리·중심선)을 지형에 얹은 3D 폴리라인으로 */
function drapeLine(dxf: DxfWriter, pts: [number, number][], tin: Tin, layer: string, lift = 0.05) {
  const p3 = pts.map(([x, y]) => ({ point: point3d(x, y, (sampleElevation(tin, x, y) ?? 0) + lift) }))
  if (p3.length >= 2) dxf.addPolyline3D(p3, { layerName: layer })
}

/**
 * 도로 면 = 버퍼 범위 − 블록(닫힌 도로경계 폴리곤). 수치지형도의 닫힌 도로경계는 도로가 아니라
 * 도로로 둘러싸인 "블록(가구)"이므로(실측 확인: 대부분 안에 건물 포함), 도로는 그 사이 공간이다.
 * 사각형 bbox에서 블록들을 폴리곤 차집합으로 빼고, 남은 도로 영역(구멍 포함)을 earcut로 삼각분할해
 * 지형에 드레이프한다. 근사 없이 실측 블록 경계로만 도로를 정의한다.
 */
function drapeRoadCorridor(
  dxf: DxfWriter,
  blocks: [number, number][][],
  bbox: BBox,
  tin: Tin,
  layer: string
): number {
  const rect: [number, number][] = [
    [bbox.minX, bbox.minY],
    [bbox.maxX, bbox.minY],
    [bbox.maxX, bbox.maxY],
    [bbox.minX, bbox.maxY],
    [bbox.minX, bbox.minY],
  ]
  // polygon-clipping 형식: Polygon = ring[] (첫 ring=외곽). MultiPolygon = Polygon[]
  const subject = [[rect]] as any
  const clippers = blocks.filter((b) => b.length >= 4).map((b) => [b]) as any[]
  let corridor: any
  try {
    corridor = polygonClipping.difference(subject, ...clippers)
  } catch {
    return 0
  }
  let faces = 0
  for (const poly of corridor) {
    // poly = [outerRing, hole1, hole2, ...]  (각 ring = [x,y][])
    const flat: number[] = []
    const holeIdx: number[] = []
    for (let r = 0; r < poly.length; r++) {
      if (r > 0) holeIdx.push(flat.length / 2)
      // earcut은 닫힘 중복점 없어도 됨 — 마지막 중복점 제거
      const ring = poly[r]
      const end = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.length - 1 : ring.length
      for (let i = 0; i < end; i++) {
        flat.push(ring[i][0], ring[i][1])
      }
    }
    const tris = earcut(flat, holeIdx.length ? holeIdx : undefined, 2)
    for (let i = 0; i < tris.length; i += 3) {
      const ax = flat[tris[i] * 2],
        ay = flat[tris[i] * 2 + 1]
      const bx = flat[tris[i + 1] * 2],
        by = flat[tris[i + 1] * 2 + 1]
      const cx = flat[tris[i + 2] * 2],
        cy = flat[tris[i + 2] * 2 + 1]
      const az = (sampleElevation(tin, ax, ay) ?? 0) + 0.03
      const bz = (sampleElevation(tin, bx, by) ?? 0) + 0.03
      const cz = (sampleElevation(tin, cx, cy) ?? 0) + 0.03
      dxf.add3dFace(point3d(ax, ay, az), point3d(bx, by, bz), point3d(cx, cy, cz), point3d(cx, cy, cz), {
        layerName: layer,
      })
      faces++
    }
  }
  return faces
}

export interface Site3dStats {
  지형삼각형수: number
  건물수: number
  extrude된건물수: number
  표고점수: number
  도로면: number
  도로선: number
  하천면: number
}

export interface Site3dResult {
  dxfText: string
  stats: Site3dStats
}

/**
 * 3D DXF 생성: 지형 TIN + 건물 extrude + 대상 필지 경계(지형에 얹음).
 * @param bbox 대상 필지 버퍼 — TIN/건물을 이 범위로 제한
 * @param floorHeight 층고(m), 기본 3.3
 */
export function build3dSiteDxf(
  target: ParcelGeometry,
  tin: Tin,
  buildings: BuildingFootprint[],
  bbox: BBox,
  floorHeight = 3.3,
  gridCell?: number,
  topoEntities?: TopoEntity[]
): Site3dResult {
  const dxf = new DxfWriter()
  dxf.addLayer(L_TERRAIN, 3 /* Green */, "CONTINUOUS")
  dxf.addLayer(L_BUILDING, 8 /* 회색 */, "CONTINUOUS")
  dxf.addLayer(L_PARCEL, 1 /* Red */, "CONTINUOUS")
  dxf.addLayer(L_ROAD_SURFACE, 9 /* 밝은회색 */, "CONTINUOUS")
  dxf.addLayer(L_ROAD_EDGE, 8, "CONTINUOUS")
  dxf.addLayer(L_RIVER_SURFACE, 5 /* Blue */, "CONTINUOUS")

  const inBox = (x: number, y: number) =>
    x >= bbox.minX && x <= bbox.maxX && y >= bbox.minY && y <= bbox.maxY

  // 1) 지형 표면
  let terrainTriCount = 0
  const { points, triangles } = tin
  if (gridCell && gridCell > 0) {
    // topoROK 방식: TIN을 격자로 재샘플링해 매끄러운 격자 면. 네 꼭짓점이 모두 유효한 셀만
    // 두 삼각형(3DFACE)으로 그린다.
    const grid = resampleToGrid(tin, bbox, gridCell)
    for (let ix = 0; ix < grid.nx; ix++) {
      for (let iy = 0; iy < grid.ny; iy++) {
        const z00 = grid.z[ix][iy]
        const z10 = grid.z[ix + 1][iy]
        const z11 = grid.z[ix + 1][iy + 1]
        const z01 = grid.z[ix][iy + 1]
        if (z00 === null || z10 === null || z11 === null || z01 === null) continue
        const x0 = grid.minX + ix * grid.cell
        const x1 = grid.minX + (ix + 1) * grid.cell
        const y0 = grid.minY + iy * grid.cell
        const y1 = grid.minY + (iy + 1) * grid.cell
        // 사각형 셀을 4각 3DFACE 하나로 (약간 뒤틀려도 CAD가 삼각화)
        dxf.add3dFace(
          point3d(x0, y0, z00),
          point3d(x1, y0, z10),
          point3d(x1, y1, z11),
          point3d(x0, y1, z01),
          { layerName: L_TERRAIN }
        )
        terrainTriCount++
      }
    }
  } else {
    // raw TIN — bbox 안에 걸치는 삼각형만
    for (let i = 0; i < triangles.length; i += 3) {
      const a = points[triangles[i]]
      const b = points[triangles[i + 1]]
      const c = points[triangles[i + 2]]
      if (!inBox(a[0], a[1]) && !inBox(b[0], b[1]) && !inBox(c[0], c[1])) continue
      dxf.add3dFace(
        point3d(a[0], a[1], a[2]),
        point3d(b[0], b[1], b[2]),
        point3d(c[0], c[1], c[2]),
        point3d(c[0], c[1], c[2]),
        { layerName: L_TERRAIN }
      )
      terrainTriCount++
    }
  }

  // 2) 건물 extrude
  let extruded = 0
  for (const bld of buildings) {
    for (const polygon of bld.polygons) {
      const ring = polygon[0] // 외곽 링
      if (!ring || ring.length < 3) continue
      const [cx, cy] = ringCentroid(ring)
      if (!inBox(cx, cy)) continue

      const baseZ = sampleElevation(tin, cx, cy) ?? 0
      const floors = bld.지상층수 > 0 ? bld.지상층수 : 1
      const topZ = baseZ + floors * floorHeight

      // 벽면: 각 변을 수직 4각 면으로
      for (let k = 0; k < ring.length - 1; k++) {
        const [x1, y1] = ring[k]
        const [x2, y2] = ring[k + 1]
        dxf.add3dFace(
          point3d(x1, y1, baseZ),
          point3d(x2, y2, baseZ),
          point3d(x2, y2, topZ),
          point3d(x1, y1, topZ),
          { layerName: L_BUILDING }
        )
      }
      // 지붕: 중심에서 부채꼴 삼각분할 (단순 볼록 근사)
      for (let k = 0; k < ring.length - 1; k++) {
        const [x1, y1] = ring[k]
        const [x2, y2] = ring[k + 1]
        dxf.add3dFace(
          point3d(cx, cy, topZ),
          point3d(x1, y1, topZ),
          point3d(x2, y2, topZ),
          point3d(x2, y2, topZ),
          { layerName: L_BUILDING }
        )
      }
      extruded++
    }
  }

  // 3) 도로·하천 — 수치지형도 실측 형상을 지형에 드레이프 (근사 없음)
  let roadSurf = 0,
    roadEdge = 0,
    riverSurf = 0
  if (topoEntities) {
    // 도로: 닫힌 도로경계=블록(가구)이므로, 도로 면은 "버퍼 − 블록"의 사이 공간으로 계산
    const blocks: [number, number][][] = []
    for (const e of topoEntities) {
      if (e.category !== "도로경계") continue
      const [cx, cy] = ringCentroid(e.points)
      if (!inBox(cx, cy)) continue
      if (isClosedRing(e.points)) {
        blocks.push(e.points)
      } else {
        drapeLine(dxf, e.points, tin, L_ROAD_EDGE)
        roadEdge++
      }
    }
    if (blocks.length > 0) {
      roadSurf = drapeRoadCorridor(dxf, blocks, bbox, tin, L_ROAD_SURFACE)
    }

    // 하천: 실폭하천은 실제 강 면(닫힘)이므로 그대로 채우고, 중심선은 선으로
    for (const e of topoEntities) {
      if (e.points.length < 2) continue
      const [cx, cy] = ringCentroid(e.points)
      if (!inBox(cx, cy)) continue
      if (e.category === "실폭하천" && isClosedRing(e.points)) {
        drapePolygon(dxf, e.points, tin, L_RIVER_SURFACE)
        riverSurf++
      } else if (e.category === "하천중심선" || e.category === "실폭하천") {
        drapeLine(dxf, e.points, tin, L_RIVER_SURFACE)
      }
    }
  }

  // 4) 대상 필지 경계 — 지형면 위에 얹어(각 정점 표고 샘플링) 3D 폴리라인
  for (const polygon of target.polygons) {
    for (const ring of polygon) {
      if (ring.length < 2) continue
      const pts3 = ring.map(([x, y]) => ({ point: point3d(x, y, (sampleElevation(tin, x, y) ?? 0) + 0.15) }))
      dxf.addPolyline3D(pts3, { layerName: L_PARCEL })
    }
  }

  return {
    dxfText: dxf.stringify(),
    stats: {
      지형삼각형수: terrainTriCount,
      건물수: buildings.length,
      extrude된건물수: extruded,
      표고점수: points.length,
      도로면: roadSurf,
      도로선: roadEdge,
      하천면: riverSurf,
    },
  }
}
