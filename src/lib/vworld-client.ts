/**
 * 브이월드(VWorld) 국토정보플랫폼 API 클라이언트
 * https://www.vworld.kr/dev/v4dv_geocoderguide2_s001.do
 * https://www.vworld.kr/dev/v4dv_ned_s001.do
 */

import * as http from "http"
import * as https from "https"
import { CadastralApiError } from "./errors.js"

const VWORLD_KEY = process.env.VWORLD_KEY || ""
const VWORLD_DOMAIN = process.env.VWORLD_DOMAIN || ""

export interface LandRegister {
  법정동명: string
  지번: string
  지목: string
  면적: string
  소유구분: string
}

export interface IndividualLandPrice {
  기준연도: string
  제곱미터당공시지가: string
}

/** GeoJSON MultiPolygon 관례: polygons[polygon][ring][point] = [x, y]. ring[0]=외곽, 나머지=구멍(홀) */
export interface ParcelGeometry {
  pnu: string
  crs: string
  지번: string
  주소: string
  제곱미터당공시지가: string
  공시기준연도: string
  polygons: number[][][][]
}

export function requireVworldKey(): void {
  if (!VWORLD_KEY) {
    throw new CadastralApiError(
      "VWORLD_KEY 환경변수가 설정되지 않았습니다.",
      [
        "https://www.vworld.kr/dev/v4dv_apikey_s001.do 에서 API 키를 발급받으세요.",
        ".env 파일에 VWORLD_KEY=발급받은키 를 설정하세요.",
      ]
    )
  }
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http
    mod
      .get(url, (res) => {
        let data = ""
        res.on("data", (chunk) => (data += chunk))
        res.on("end", () => resolve(data))
      })
      .on("error", reject)
  })
}

function domainParam(): string {
  return VWORLD_DOMAIN ? `&domain=${encodeURIComponent(VWORLD_DOMAIN)}` : ""
}

/**
 * 지번 주소 → PNU(19자리 필지고유번호) 변환
 */
export async function addressToPnu(
  address: string
): Promise<{ pnu: string; refinedAddress: string }> {
  requireVworldKey()

  const url = `https://api.vworld.kr/req/address?service=address&request=getCoord&type=PARCEL&key=${VWORLD_KEY}&address=${encodeURIComponent(address)}`
  const raw = await httpGet(url)
  const json = JSON.parse(raw)
  const pnu = json?.response?.refined?.structure?.level4LC
  const refinedAddress = json?.response?.refined?.text || address

  if (!pnu || pnu.length !== 19) {
    throw new CadastralApiError(`주소에서 PNU를 찾을 수 없습니다: ${address}`, [
      "주소가 정확한 지번 주소인지 확인하세요 (도로명 주소는 인식되지 않을 수 있습니다).",
      "PNU를 이미 알고 있다면 pnu 파라미터로 직접 조회하세요.",
    ])
  }

  return { pnu, refinedAddress }
}

/**
 * PNU → 토지대장 정보 (지목/면적/소유구분)
 */
export async function getLandRegister(pnu: string): Promise<LandRegister | null> {
  requireVworldKey()

  const url = `http://api.vworld.kr/ned/data/ladfrlList?pnu=${pnu}&key=${VWORLD_KEY}${domainParam()}`
  const raw = await httpGet(url)
  const json = JSON.parse(raw)
  const list = json?.ladfrlVOList?.ladfrlVOList
  const arr = Array.isArray(list) ? list : list ? [list] : []
  const item = arr[0]

  if (!item) return null

  return {
    법정동명: item.ldCodeNm || "",
    지번: item.mnnmSlno || "",
    지목: item.lndcgrCodeNm || "",
    면적: item.lndpclAr || "",
    소유구분: item.posesnSeCodeNm || "",
  }
}

/**
 * PNU → 용도지역/지구/구역 목록
 */
export async function getLandUseZones(pnu: string): Promise<string[]> {
  requireVworldKey()

  const url = `http://api.vworld.kr/ned/data/getLandUseAttr?pnu=${pnu}&cnflcAt=1&key=${VWORLD_KEY}${domainParam()}`
  const raw = await httpGet(url)
  const json = JSON.parse(raw)
  const list = json?.landUses?.field
  const arr = Array.isArray(list) ? list : list ? [list] : []

  return arr.map((item: any) => item.prposAreaDstrcCodeNm).filter(Boolean)
}

/**
 * PNU → 개별공시지가 (기준연도 미지정 시 올해)
 * 응답 필드(indvdLandPrices.field[].pblntfPclnd 등) 실제 키로 검증 완료 (2026-07-14)
 */
export async function getIndividualLandPrice(
  pnu: string,
  stdrYear?: string
): Promise<IndividualLandPrice[]> {
  requireVworldKey()

  const year = stdrYear || String(new Date().getFullYear())
  const url = `http://api.vworld.kr/ned/data/getIndvdLandPriceAttr?pnu=${pnu}&stdrYear=${year}&key=${VWORLD_KEY}${domainParam()}`
  const raw = await httpGet(url)
  const json = JSON.parse(raw)
  const list = json?.indvdLandPrices?.field
  const arr = Array.isArray(list) ? list : list ? [list] : []

  return arr.map((item: any) => ({
    기준연도: item.stdrYear || year,
    제곱미터당공시지가: item.pblntfPclnd || "",
  }))
}

/**
 * PNU → 지적 필지 경계 폴리곤 (연속지적도, LP_PA_CBND_BUBUN)
 * 2D데이터 API가 지정한 투영좌표계(EPSG:5186 등)로 미터 단위 좌표를 직접 반환하므로
 * 별도 좌표변환(proj4 등) 없이 바로 DXF에 쓸 수 있다. 응답 구조 검증 완료 (2026-07-14)
 */
export async function getParcelGeometry(
  pnu: string,
  crs: string = "EPSG:5186"
): Promise<ParcelGeometry | null> {
  requireVworldKey()

  const url = `https://api.vworld.kr/req/data?service=data&request=GetFeature&data=LP_PA_CBND_BUBUN&key=${VWORLD_KEY}${domainParam()}&attrFilter=pnu:=:${pnu}&format=json&crs=${crs}`
  const raw = await httpGet(url)
  const json = JSON.parse(raw)

  if (json?.response?.status !== "OK") {
    return null
  }

  const feature = json?.response?.result?.featureCollection?.features?.[0]
  if (!feature) return null

  const geometry = feature.geometry
  const props = feature.properties || {}

  const polygons: number[][][][] =
    geometry.type === "MultiPolygon"
      ? geometry.coordinates
      : geometry.type === "Polygon"
        ? [geometry.coordinates]
        : []

  return {
    pnu,
    crs,
    지번: props.jibun || "",
    주소: props.addr || "",
    제곱미터당공시지가: props.jiga || "",
    공시기준연도: props.gosi_year || "",
    polygons,
  }
}

export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface NeighborParcel {
  pnu: string
  지번: string
  polygons: number[][][][]
}

/**
 * 필지 폴리곤(외곽 링 전체)의 투영좌표 경계상자 계산 후 buffer(m)만큼 확장
 */
export function boundingBoxOf(parcel: ParcelGeometry, bufferMeters: number): BBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const polygon of parcel.polygons) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  return {
    minX: minX - bufferMeters,
    minY: minY - bufferMeters,
    maxX: maxX + bufferMeters,
    maxY: maxY + bufferMeters,
  }
}

/**
 * 경계상자 내 모든 필지 조회 (연속지적도, LP_PA_CBND_BUBUN)
 * geomFilter=BOX(minX,minY,maxX,maxY) — 대상 필지 주변 맥락(공공도로/이웃 필지)을 함께 그리는 용도
 */
export async function getParcelsInBBox(
  bbox: BBox,
  crs: string,
  excludePnu?: string
): Promise<NeighborParcel[]> {
  requireVworldKey()

  const geomFilter = `BOX(${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY})`
  const url = `https://api.vworld.kr/req/data?service=data&request=GetFeature&data=LP_PA_CBND_BUBUN&key=${VWORLD_KEY}${domainParam()}&geomFilter=${encodeURIComponent(geomFilter)}&format=json&crs=${crs}&size=1000`
  const raw = await httpGet(url)
  const json = JSON.parse(raw)

  if (json?.response?.status !== "OK") return []

  const features = json?.response?.result?.featureCollection?.features || []

  return features
    .filter((f: any) => f.properties?.pnu !== excludePnu)
    .map((f: any) => {
      const geometry = f.geometry
      const polygons: number[][][][] =
        geometry?.type === "MultiPolygon"
          ? geometry.coordinates
          : geometry?.type === "Polygon"
            ? [geometry.coordinates]
            : []
      return {
        pnu: f.properties?.pnu || "",
        지번: f.properties?.jibun || "",
        polygons,
      }
    })
}
