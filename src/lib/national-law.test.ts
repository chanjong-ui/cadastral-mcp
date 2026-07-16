import { describe, it, expect } from "vitest"
import { extractZoneRange, getNationalLandscapeStandard } from "./national-law.js"
import { flattenText, flattenArticleUnit } from "./national-law-api-client.js"

describe("extractZoneRange", () => {
  // 국가법령 용적률(국토계획법 시행령 제85조)은 조례와 달리 "X% 이상 Y% 이하" 범위로 되어 있다.
  it("용도지역 뒤 범위(이상~이하)를 정확히 뽑는다", () => {
    const content =
      "3.  제1종일반주거지역 : 100퍼센트 이상 200퍼센트 이하4.  제2종일반주거지역 : 100퍼센트 이상 250퍼센트 이하5.  제3종일반주거지역 : 100퍼센트 이상 300퍼센트 이하"
    expect(extractZoneRange(content, "제2종일반주거지역")).toEqual({ min: 100, max: 250 })
    expect(extractZoneRange(content, "제1종일반주거지역")).toEqual({ min: 100, max: 200 })
  })

  // extractZonePercent의 "604." 버그와 같은 계열: 값의 마지막 자리가 다음 항목번호와 붙는 경우.
  it("값의 마지막 자리가 다음 항목번호와 붙어도 정확한 범위를 뽑는다", () => {
    const content = "6.  준주거지역 : 200퍼센트 이상 500퍼센트 이하7.  중심상업지역 : 200퍼센트 이상 1500퍼센트 이하"
    expect(extractZoneRange(content, "준주거지역")).toEqual({ min: 200, max: 500 })
  })

  it("존재하지 않는 용도지역명은 null", () => {
    expect(extractZoneRange("제2종일반주거지역 : 100퍼센트 이상 250퍼센트 이하", "준공업지역")).toBeNull()
  })

  it("범위 표기가 아니면(단일값) null", () => {
    expect(extractZoneRange("제1종전용주거지역：100분의 50", "제1종전용주거지역")).toBeNull()
  })
})

describe("getNationalLandscapeStandard", () => {
  it("녹지지역이 포함되면 API 호출 없이 면제 대상으로 즉시 응답한다", async () => {
    const result = await getNationalLandscapeStandard(["자연녹지지역"])
    expect(result).toEqual({ value: "녹지지역 — 조경 조치 면제 대상", source: "건축법 시행령 제27조제1항제1호" })
  })

  // 건축법 시행령 제27조 항①은 실제로는 조경 면적표가 아니라 면제 대상 목록이라, 녹지가 아니면
  // 국가법령 차원의 %가 애초에 없다 — null을 반환해 zoning-standards.ts의 정적 안내문으로 폴백시킨다.
  it("녹지지역이 아니면 null (국가법령에 % 기준 자체가 없음 — 조례 확인 필요로 폴백)", async () => {
    const result = await getNationalLandscapeStandard(["제1종일반주거지역"])
    expect(result).toBeNull()
  })
})

describe("flattenText", () => {
  it("문자열은 그대로 반환한다", () => {
    expect(flattenText("가.  일반도로")).toBe("가.  일반도로")
  })

  it("중첩 배열(목내용에서 흔함)을 이어붙인다", () => {
    expect(flattenText([["나. 요건을 모두 충족할 것", "1) 기존 부지에 증축할 것"]])).toBe(
      "나. 요건을 모두 충족할 것1) 기존 부지에 증축할 것"
    )
  })

  it("문자열도 배열도 아니면 빈 문자열", () => {
    expect(flattenText(undefined)).toBe("")
    expect(flattenText(null)).toBe("")
  })
})

describe("flattenArticleUnit", () => {
  it("항→호→목 구조를 조례 형식과 같은 평탄한 content로 합친다", () => {
    const unit = {
      조문번호: "84",
      조문내용: "제84조(용도지역안에서의 건폐율)",
      조문제목: "용도지역안에서의 건폐율",
      항: [
        {
          항번호: "①",
          항내용: "①법 제77조에 따른 건폐율은 다음 각 호와 같다.",
          호: [
            { 호번호: "1.", 호내용: "1.  제1종전용주거지역 : 50퍼센트 이하" },
            { 호번호: "2.", 호내용: "2.  제2종전용주거지역 : 50퍼센트 이하" },
          ],
        },
      ],
    }
    const article = flattenArticleUnit(unit)
    expect(article.articleNo).toBe("84")
    expect(article.title).toBe("용도지역안에서의 건폐율")
    expect(article.content).toBe(
      "제84조(용도지역안에서의 건폐율)①법 제77조에 따른 건폐율은 다음 각 호와 같다.1.  제1종전용주거지역 : 50퍼센트 이하2.  제2종전용주거지역 : 50퍼센트 이하"
    )
  })

  // 실사용 중 발견한 버그: 조문가지번호(예: 제12조의2)를 안 붙이면 목차에서 "12"가 여러 번
  // 중복되는 것처럼 보여 어느 조문인지 구분할 수 없었다.
  it("조문가지번호가 있으면 articleNo에 '의N'을 붙인다", () => {
    const unit = {
      조문번호: "12",
      조문가지번호: "2",
      조문내용: "제12조의2(기계식주차장치의 안전도인증 신청 등)",
      조문제목: "기계식주차장치의 안전도인증 신청 등",
    }
    expect(flattenArticleUnit(unit).articleNo).toBe("12의2")
  })

  it("조문가지번호가 없으면 base 번호만 쓴다", () => {
    const unit = { 조문번호: "13", 조문내용: "제13조(점용료 및 사용료의 감면)", 조문제목: "점용료 및 사용료의 감면" }
    expect(flattenArticleUnit(unit).articleNo).toBe("13")
  })
})
