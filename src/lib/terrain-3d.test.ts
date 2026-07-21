import { describe, it, expect } from "vitest"
import { collectElevationPoints, buildTin, sampleElevation, resampleToGrid, type Pt3 } from "./terrain-3d.js"
import type { TopoEntity } from "./topo-dxf-reader.js"

const contour = (elev: number, pts: [number, number][]): TopoEntity => ({
  category: "등고선",
  layerCode: "F0010000",
  layerName: "F0010000",
  type: "LWPOLYLINE",
  points: pts,
  elevation: elev,
})
const spot = (elev: number, x: number, y: number): TopoEntity => ({
  category: "표고점",
  layerCode: "F0020000",
  layerName: "F0020000",
  type: "POINT",
  points: [[x, y]],
  elevation: elev,
})

describe("collectElevationPoints", () => {
  it("등고선 정점에 그 등고선 표고를 부여하고, 표고점은 (x,y,z)로 모은다", () => {
    const pts = collectElevationPoints([
      contour(10, [[0, 0], [10, 0]]),
      spot(15, 5, 5),
    ])
    expect(pts).toContainEqual([0, 0, 10])
    expect(pts).toContainEqual([10, 0, 10])
    expect(pts).toContainEqual([5, 5, 15])
  })

  it("표고 없는 엔티티는 제외한다", () => {
    const noElev: TopoEntity = { category: "등고선", layerCode: "F0010000", layerName: "F", type: "LWPOLYLINE", points: [[0, 0]] }
    expect(collectElevationPoints([noElev])).toHaveLength(0)
  })
})

describe("buildTin + sampleElevation", () => {
  // 네 모서리(z=0,10,20,10) + 중앙 → 평면 보간 검증
  const pts: Pt3[] = [
    [0, 0, 0],
    [10, 0, 10],
    [10, 10, 20],
    [0, 10, 10],
  ]
  const tin = buildTin(pts)

  it("공간 인덱스가 자동 부착된다", () => {
    expect(tin.index).toBeDefined()
    expect(tin.triangles.length).toBeGreaterThan(0)
  })

  it("삼각형 내부 점의 표고를 무게중심 보간한다", () => {
    // (0,0,0)-(10,0,10) 변의 중점 → z=5
    const z = sampleElevation(tin, 5, 0)
    expect(z).toBeCloseTo(5, 5)
  })

  it("꼭짓점에서는 그 점의 표고를 반환한다", () => {
    expect(sampleElevation(tin, 0, 0)).toBeCloseTo(0, 5)
    expect(sampleElevation(tin, 10, 10)).toBeCloseTo(20, 5)
  })

  it("인덱스 유무와 무관하게 동일한 값을 반환한다", () => {
    const withIdx = sampleElevation(tin, 5, 5)
    const noIdx = sampleElevation({ points: tin.points, triangles: tin.triangles }, 5, 5)
    expect(withIdx).toBeCloseTo(noIdx as number, 6)
  })

  it("점이 없으면 null", () => {
    expect(sampleElevation(buildTin([]), 5, 5)).toBeNull()
  })
})

describe("resampleToGrid", () => {
  const tin = buildTin([
    [0, 0, 0],
    [10, 0, 0],
    [10, 10, 10],
    [0, 10, 10],
  ])
  it("bbox를 격자 간격으로 나눈 표고 격자를 만든다", () => {
    const grid = resampleToGrid(tin, { minX: 0, minY: 0, maxX: 10, maxY: 10 }, 5)
    expect(grid.nx).toBe(2)
    expect(grid.ny).toBe(2)
    expect(grid.z.length).toBe(3) // nx+1
    // y=0 라인은 z=0, y=10 라인은 z=10 근처
    expect(grid.z[0][0]).toBeCloseTo(0, 5)
    expect(grid.z[0][2]).toBeCloseTo(10, 5)
  })
})
