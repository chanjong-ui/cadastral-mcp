import { describe, it, expect } from "vitest"
import { findZoningStandard, buildingCoverageCell, floorAreaRatioCell, landscapeCell } from "./zoning-standards.js"

describe("findZoningStandard", () => {
  it("21종 용도지역 중 하나를 목록에서 찾는다", () => {
    const result = findZoningStandard(["자연재해위험개선지구", "가축사육제한구역", "생산녹지지역"])
    expect(result?.zoneName).toBe("생산녹지지역")
    expect(result?.standard.buildingCoverageMax).toBe("20% 이하")
    expect(result?.standard.floorAreaRatioRange).toBe("50~100%")
  })

  it("지구/구역만 있고 용도지역이 없으면 null", () => {
    expect(findZoningStandard(["자연재해위험개선지구", "가축사육제한구역"])).toBeNull()
  })

  it("빈 배열은 null", () => {
    expect(findZoningStandard([])).toBeNull()
  })
})

describe("buildingCoverageCell / floorAreaRatioCell", () => {
  it("매칭되면 상한과 용도지역명을 함께 표시한다", () => {
    expect(buildingCoverageCell(["생산녹지지역"])).toBe("20% 이하 (생산녹지지역)")
    expect(floorAreaRatioCell(["생산녹지지역"])).toBe("50~100% (생산녹지지역)")
  })

  it("매칭 안 되면 미확인 문구를 표시한다", () => {
    expect(buildingCoverageCell(["가축사육제한구역"])).toBe("- (용도지역 미확인)")
    expect(floorAreaRatioCell(["가축사육제한구역"])).toBe("- (용도지역 미확인)")
  })
})

describe("landscapeCell", () => {
  it("녹지지역(보전/생산/자연)은 조경 조치 면제 대상으로 안내한다", () => {
    expect(landscapeCell(["생산녹지지역"])).toBe("녹지지역 — 조경 조치 면제 대상")
    expect(landscapeCell(["보전녹지지역"])).toBe("녹지지역 — 조경 조치 면제 대상")
    expect(landscapeCell(["자연녹지지역"])).toBe("녹지지역 — 조경 조치 면제 대상")
  })

  it("녹지지역이 아니면 일반 기준 안내로 폴백한다", () => {
    expect(landscapeCell(["제1종일반주거지역"])).toBe("면적·용도별 기준 상이 — 조례 확인 필요")
  })
})
