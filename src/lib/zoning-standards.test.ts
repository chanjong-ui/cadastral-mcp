import { describe, it, expect } from "vitest"
import {
  findZoningStandard,
  buildingCoverageCell,
  floorAreaRatioCell,
  landscapeCell,
  resolveParkingUse,
  nationalParkingCell,
} from "./zoning-standards.js"

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

describe("resolveParkingUse (건축용도 → 주차장법 별표1 분류)", () => {
  it("사무소/업무시설 → 150㎡당 1대", () => {
    expect(resolveParkingUse("사무소")?.rate).toBe("시설면적 150㎡당 1대")
    expect(resolveParkingUse("업무시설")?.rate).toBe("시설면적 150㎡당 1대")
  })

  it("1종/2종 근린생활시설 → 200㎡당 1대", () => {
    expect(resolveParkingUse("제1종근린생활시설")?.category).toBe("제1종 근린생활시설")
    expect(resolveParkingUse("제1종근린생활시설")?.rate).toBe("시설면적 200㎡당 1대")
    expect(resolveParkingUse("제2종 근린생활시설")?.rate).toBe("시설면적 200㎡당 1대")
  })

  it("창고 400㎡, 공장 350㎡, 위락 100㎡", () => {
    expect(resolveParkingUse("창고시설")?.rate).toBe("시설면적 400㎡당 1대")
    expect(resolveParkingUse("공장")?.rate).toContain("350㎡당 1대")
    expect(resolveParkingUse("위락시설")?.rate).toBe("시설면적 100㎡당 1대")
  })

  it("오피스텔은 업무시설이 아니라 주택건설기준(전용면적별)로 분류", () => {
    const r = resolveParkingUse("오피스텔")
    expect(r?.category).toContain("오피스텔")
    expect(r?.rate).toContain("전용면적")
  })

  it("공동주택/다세대는 주택건설기준(세대별)", () => {
    expect(resolveParkingUse("다세대주택")?.rate).toContain("세대별")
    expect(resolveParkingUse("아파트")?.category).toBe("공동주택")
  })

  it("미지정·미분류 용도는 null", () => {
    expect(resolveParkingUse()).toBeNull()
    expect(resolveParkingUse("우주정거장")).toBeNull()
  })
})

describe("nationalParkingCell", () => {
  it("용도 지정 시 용도별 셀, 미지정 시 그 밖의 건축물 catch-all", () => {
    expect(nationalParkingCell("사무소")).toBe("업무시설: 시설면적 150㎡당 1대 (주차장법 시행령 별표1)")
    expect(nationalParkingCell()).toBe("그 밖의 건축물: 300m2당 1대 (용도별 별도 기준 있음)")
    expect(nationalParkingCell("우주정거장")).toBe("그 밖의 건축물: 300m2당 1대 (용도별 별도 기준 있음)")
  })
})
