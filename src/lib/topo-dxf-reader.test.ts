import { describe, it, expect } from "vitest"
import { categorize, extractLayerCode, clipTopoEntities, type TopoEntity } from "./topo-dxf-reader.js"

describe("categorize", () => {
  // 국토지리정보원 표준 8자리 통합코드 앞자리로 분류 (F001=등고선, F002=표고점, B001=건물 등)
  it("표준 코드 접두로 지형지물을 분류한다", () => {
    expect(categorize("F0010000")).toBe("등고선")
    expect(categorize("F0017111")).toBe("등고선")
    expect(categorize("F0020000")).toBe("표고점")
    expect(categorize("B0010000")).toBe("건물")
    expect(categorize("A0020000")).toBe("도로중심선")
    expect(categorize("A0010000")).toBe("도로경계")
    expect(categorize("E0020000")).toBe("하천중심선")
    expect(categorize("E0032111")).toBe("실폭하천")
  })

  it("기타 지형(F 나머지)과 무관 코드를 구분한다", () => {
    expect(categorize("F0040000")).toBe("기타지형")
    expect(categorize("H0010000")).toBe("기타") // 주기
    expect(categorize("")).toBe("기타")
  })
})

describe("extractLayerCode", () => {
  it("N1L_F0010000 형태에서 8자리 코드를 뽑는다", () => {
    expect(extractLayerCode("N1L_F0010000")).toBe("F0010000")
  })

  it("코드만 있으면 그대로 반환한다", () => {
    expect(extractLayerCode("F0017111")).toBe("F0017111")
  })

  it("코드가 없으면 원본 레이어명을 반환한다", () => {
    expect(extractLayerCode("도곽선")).toBe("도곽선")
  })
})

describe("clipTopoEntities", () => {
  const bbox = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
  const mk = (category: TopoEntity["category"], points: [number, number][]): TopoEntity => ({
    category,
    layerCode: "X",
    layerName: "X",
    type: "LWPOLYLINE",
    points,
  })

  it("bbox 안에 정점이 하나라도 있으면 유지(걸치는 것 살림)", () => {
    const inside = mk("건물", [[50, 50]])
    const crossing = mk("도로중심선", [[-20, 50], [50, 50]])
    const outside = mk("건물", [[200, 200]])
    const res = clipTopoEntities([inside, crossing, outside], bbox)
    expect(res).toHaveLength(2)
    expect(res).toContain(inside)
    expect(res).toContain(crossing)
  })

  it("'기타' 분류(도곽선·잡엔티티)는 제외한다", () => {
    const etc = mk("기타", [[50, 50]])
    expect(clipTopoEntities([etc], bbox)).toHaveLength(0)
  })
})
