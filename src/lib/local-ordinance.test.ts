import { describe, it, expect } from "vitest"
import {
  extractCityCandidates,
  extractZonePercent,
  extractOtherFacilityParkingRate,
  articleCitation,
  findSelfAnnexNumber,
} from "./local-ordinance.js"

describe("extractCityCandidates", () => {
  it("일반 시 산하 일반구 주소는 시를 우선 후보로 준다", () => {
    expect(extractCityCandidates("가상도 가상시 가상구 가상동")).toEqual(["가상시", "가상도"])
  })

  it("특별시 산하 자치구 주소도 구를 우선 후보로 준다", () => {
    expect(extractCityCandidates("서울특별시 강남구 역삼동")).toEqual(["강남구", "서울특별시"])
  })

  it("특별자치시는 하위 행정동이 시/군/구로 안 끝나면 자기 자신만 후보", () => {
    expect(extractCityCandidates("세종특별자치시 반곡동")).toEqual(["세종특별자치시"])
  })

  it("빈 문자열은 빈 배열", () => {
    expect(extractCityCandidates("")).toEqual([])
  })
})

describe("extractZonePercent", () => {
  // 실제 조례 원문은 항목 사이 공백이 없어 "100분의 20" 뒤에 바로 "15." 같은 다음 항목번호가
  // 붙는다. 이 테스트는 그 값이 "2015" 같은 잘못된 숫자로 안 읽히는지 확인한다 (실사용 중 발견한 버그).
  it("다음 항목번호가 값에 바로 붙어도 정확한 값만 뽑는다", () => {
    const content = "14. 보전녹지지역：100분의 2015. 생산녹지지역：100분의 2016. 자연녹지지역：100분의 20"
    expect(extractZonePercent(content, "생산녹지지역")).toBe(20)
    expect(extractZonePercent(content, "보전녹지지역")).toBe(20)
  })

  // 실사용 중 발견한 버그: 값의 마지막 자리와 다음 항목번호(한 자리)가 붙어 "604."처럼 보이면,
  // 옛 방식(\d{1,2} 추측)은 "04."를 통째로 항목번호로 착각해 값 "60"이 "6"으로 잘렸다.
  it("값의 마지막 자리가 다음 항목번호와 붙어도 정확한 값만 뽑는다 (604. 케이스)", () => {
    const content = "3. 제1종일반주거지역：100분의 604. 제2종일반주거지역：100분의 605. 제3종일반주거지역：100분의 50"
    expect(extractZonePercent(content, "제1종일반주거지역")).toBe(60)
    expect(extractZonePercent(content, "제2종일반주거지역")).toBe(60)
  })

  it("마지막 항목(뒤에 알려진 용도지역명이 없는 경우)도 20자 이내면 값을 뽑는다", () => {
    const content = "20. 농림지역：100분의 20 21. 공업지역에 있는 산업단지는 100분의 80"
    expect(extractZonePercent(content, "농림지역")).toBe(20)
  })

  it("퍼센트/% 표기도 매칭한다", () => {
    expect(extractZonePercent("생산녹지지역 : 50퍼센트", "생산녹지지역")).toBe(50)
    expect(extractZonePercent("자연녹지지역: 80%", "자연녹지지역")).toBe(80)
  })

  it("존재하지 않는 용도지역명은 null", () => {
    expect(extractZonePercent("생산녹지지역：100분의 20", "준공업지역")).toBeNull()
  })
})

describe("extractOtherFacilityParkingRate", () => {
  it("기타 시설물 행의 설치기준 셀을 뽑는다", () => {
    const markdown = [
      "| 시설물 | 설치기준 |",
      "| --- | --- |",
      "| 1. 위락시설 | 시설면적 80제곱미터당 1대 |",
      "| 11. 기타 시설물 | 시설면적 250제곱미터당 1대<br>다만, 지식산업센터는 150제곱미터당 1대 |",
    ].join("\n")
    expect(extractOtherFacilityParkingRate(markdown)).toBe(
      "시설면적 250제곱미터당 1대 다만, 지식산업센터는 150제곱미터당 1대"
    )
  })

  it("그 밖의 건축물 표기 변형도 매칭한다", () => {
    const markdown = "| 11. 그 밖의 건축물 | 시설면적 300제곱미터당 1대 |"
    expect(extractOtherFacilityParkingRate(markdown)).toBe("시설면적 300제곱미터당 1대")
  })

  it("해당 행이 없으면 null", () => {
    expect(extractOtherFacilityParkingRate("| 1. 위락시설 | 시설면적 80제곱미터당 1대 |")).toBeNull()
  })
})

describe("findSelfAnnexNumber", () => {
  // 실사용 중 발견한 버그: 조문이 "영 제6조제1항의 별표 1과 같다"처럼 이 조례가 아니라
  // 상위법령(영)의 별표를 그대로 인용하는 경우, 숫자만 보고 이 조례 자신의 별표1을
  // 가져오면 전혀 다른 표(예: 부안군의 "공영주차장 주차요금표")를 잘못 반환하게 된다.
  it("영(시행령) 별표 인용은 이 조례의 자체 별표로 보지 않는다", () => {
    const content =
      "제11조(부설주차장 설치)② 법 제19조제3항에 따라 부설주차장을 설치하여야 할 시설물의 종류와 " +
      "부설주차장의 설치기준은 영 제6조제1항의 별표 1과 같다."
    expect(findSelfAnnexNumber(content)).toBeNull()
  })

  it("법/규칙 별표 인용도 마찬가지로 건너뛴다", () => {
    expect(findSelfAnnexNumber("설치기준은 법 별표 2와 같다")).toBeNull()
    expect(findSelfAnnexNumber("세부 기준은 시행규칙 별표 3에 따른다")).toBeNull()
  })

  it("타법령 인용 없이 조례 자체 별표를 가리키면 번호를 뽑는다", () => {
    expect(findSelfAnnexNumber("부설주차장의 설치대상 시설물 종류 및 설치기준은 별표7과 같다")).toBe("7")
  })

  it("타법령 인용이 앞에 있어도 뒤에 이 조례 자체 별표가 또 나오면 그것을 찾는다", () => {
    const content = "면제 기준은 영 제8조의 별표 1을 따르되, 세부 설치대상은 별표9와 같다."
    expect(findSelfAnnexNumber(content)).toBe("9")
  })
})

describe("articleCitation", () => {
  // 조번호는 article.title(조제목)이 아니라 article.content 맨 앞("제45조(...)")에 있다 — 실사용 중 발견한 버그.
  it("조번호를 title이 아니라 content에서 뽑는다", () => {
    const article = {
      articleNo: "",
      title: "용도지역안에서의 건폐율",
      content: "제45조(용도지역안에서의 건폐율)① 영 제84조제1항에 따라...",
    }
    expect(articleCitation("전주시 도시계획 조례", article)).toBe("전주시 도시계획 조례 제45조")
  })

  it("조번호를 content에서 못 찾으면 title로 폴백한다", () => {
    const article = { articleNo: "", title: "부칙", content: "이 조례는 공포한 날부터 시행한다." }
    expect(articleCitation("OO시 건축 조례", article)).toBe("OO시 건축 조례 부칙")
  })
})
