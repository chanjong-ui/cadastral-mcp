/**
 * 지적 필지 경계 폴리곤(대상 필지 + 주변 필지) → DXF 문자열 변환
 */

import {
  DxfWriter,
  point2d,
  point3d,
  LWPolylineFlags,
  Colors,
  TextHorizontalAlignment,
  TextVerticalAlignment,
  MTextAttachmentPoint,
  HatchBoundaryPaths,
  HatchPolylineBoundary,
  HatchPredefinedPatterns,
  vertex,
  pattern,
} from "@tarikjabiri/dxf"
import type { ParcelGeometry, NeighborParcel, BBox } from "./vworld-client.js"
import { buildingCoverageCell, floorAreaRatioCell, landscapeCell, PARKING_STANDARD_CELL } from "./zoning-standards.js"
import type { TopoEntity, TopoCategory } from "./topo-dxf-reader.js"

const LAYER_TARGET_BOUNDARY = "TARGET_PARCEL"
const LAYER_TARGET_LABEL = "TARGET_LABEL"
const LAYER_NEIGHBOR_BOUNDARY = "NEIGHBOR_PARCELS"
const LAYER_NEIGHBOR_LABEL = "NEIGHBOR_LABEL"
const LAYER_NOTE = "SOURCE_NOTE"
const LAYER_PANEL_BORDER = "PANEL_BORDER"
const LAYER_PANEL_TEXT = "PANEL_TEXT"
const LAYER_PANEL_TITLE = "PANEL_TITLE"
const LAYER_PANEL_TITLE_ICON = "PANEL_TITLE_ICON"
const LAYER_PANEL_TITLE_RULE = "PANEL_TITLE_RULE"
const LAYER_TABLE_GRID = "TABLE_GRID"

// 수치지형도 병합용 레이어 (지적도 블록 안에 함께 그려 XCLIP 대상이 됨)
const LAYER_TOPO_CONTOUR = "지형_등고선"
const LAYER_TOPO_SPOT = "지형_표고점"
const LAYER_TOPO_BUILDING = "지형_건물"
const LAYER_TOPO_ROAD = "지형_도로"
const LAYER_TOPO_RIVER = "지형_하천"

const TOPO_CATEGORY_LAYER: Record<TopoCategory, string | null> = {
  등고선: LAYER_TOPO_CONTOUR,
  표고점: LAYER_TOPO_SPOT,
  건물: LAYER_TOPO_BUILDING,
  도로중심선: LAYER_TOPO_ROAD,
  도로경계: LAYER_TOPO_ROAD,
  하천중심선: LAYER_TOPO_RIVER,
  실폭하천: LAYER_TOPO_RIVER,
  기타지형: null,
  기타: null,
}

const FONT_STYLE_NAME = "돋움"
const FONT_FILE_NAME = "dotum.ttf"
const MAP_BLOCK_NAME = "CADASTRAL_MAP"

/** DxfWriter와 DxfBlock(블록 내부) 둘 다 만족하는 최소 그리기 인터페이스 — 지도를 블록 안에 그릴 때 재사용 */
type DrawTarget = Pick<DxfWriter, "addLWPolyline" | "addText">

function ringCentroid(ring: number[][]): [number, number] {
  let sumX = 0
  let sumY = 0
  for (const [x, y] of ring) {
    sumX += x
    sumY += y
  }
  return [sumX / ring.length, sumY / ring.length]
}

function outerRingCentroid(polygons: number[][][][]): [number, number] | null {
  // 가장 큰 폴리곤의 외곽 링(첫 번째 링) 기준 — 멀티폴리곤/역 좌표 폴리곤 섞여도 대표점 하나는 나오게
  const outerRings = polygons.map((p) => p[0]).filter(Boolean)
  if (outerRings.length === 0) return null
  const largest = outerRings.reduce((a, b) => (a.length >= b.length ? a : b))
  return ringCentroid(largest)
}

function drawPolygons(dxf: DrawTarget, polygons: number[][][][], boundaryLayer: string, width?: number) {
  for (const polygon of polygons) {
    for (const ring of polygon) {
      const vertices = ring.map(([x, y]) => ({ point: point2d(x, y) }))
      dxf.addLWPolyline(vertices, {
        layerName: boundaryLayer,
        flags: LWPolylineFlags.Closed,
        ...(width !== undefined ? { constantWidth: width } : {}),
      })
    }
  }
}

/**
 * 모든 TEXT/MTEXT에 돋움 스타일 적용. 라이브러리가 style 옵션을 addText/addMText 인자로
 * 안 받아서, 생성된 엔티티의 textStyle 프로퍼티를 직접 덮어써야 한다.
 */
function useFont<T extends { textStyle: string }>(entity: T): T {
  entity.textStyle = FONT_STYLE_NAME
  return entity
}

function addAlignedText(
  dxf: DrawTarget,
  x: number,
  y: number,
  height: number,
  value: string,
  layerName: string,
  hAlign: TextHorizontalAlignment,
  vAlign: TextVerticalAlignment
) {
  // Left/Baseline(둘 다 0)이 아닌 정렬은 실제 앵커점을 secondAlignmentPoint(그룹코드 11/21/31)로 잡는다.
  // 안 채우면 라이브러리가 (0,0,0) 기본값을 그대로 써서 텍스트가 원점에 몰린다.
  useFont(
    dxf.addText(point3d(x, y, 0), height, value, {
      layerName,
      horizontalAlignment: hAlign,
      verticalAlignment: vAlign,
      secondAlignmentPoint: point3d(x, y, 0),
    })
  )
}

function addCenteredText(dxf: DrawTarget, x: number, y: number, height: number, value: string, layerName: string) {
  addAlignedText(dxf, x, y, height, value, layerName, TextHorizontalAlignment.Center, TextVerticalAlignment.Middle)
}

function registerFontStyle(dxf: DxfWriter) {
  const style = dxf.tables.addStyle(FONT_STYLE_NAME)
  style.fontFileName = FONT_FILE_NAME
}

function registerMapLayers(dxf: DxfWriter) {
  dxf.addLayer(LAYER_TARGET_BOUNDARY, Colors.Red, "CONTINUOUS")
  dxf.addLayer(LAYER_TARGET_LABEL, Colors.Red, "CONTINUOUS")
  dxf.addLayer(LAYER_NEIGHBOR_BOUNDARY, Colors.Blue, "CONTINUOUS")
  dxf.addLayer(LAYER_NEIGHBOR_LABEL, Colors.Blue, "CONTINUOUS")
  dxf.addLayer(LAYER_NOTE, Colors.Green, "CONTINUOUS")
}

function registerTopoLayers(dxf: DxfWriter) {
  dxf.addLayer(LAYER_TOPO_CONTOUR, Colors.Yellow, "CONTINUOUS") // 등고선 노랑
  dxf.addLayer(LAYER_TOPO_SPOT, Colors.Yellow, "CONTINUOUS")
  dxf.addLayer(LAYER_TOPO_BUILDING, Colors.Cyan, "CONTINUOUS") // 건물 청록
  dxf.addLayer(LAYER_TOPO_ROAD, 8 /* 회색 */, "CONTINUOUS") // 도로 회색
  dxf.addLayer(LAYER_TOPO_RIVER, 5 /* 파랑 */, "CONTINUOUS") // 하천 파랑
}

/**
 * 지적도 블록(DrawTarget) 안에 수치지형도 엔티티를 그린다. 지적 경계와 같은 좌표계(EPSG:5186)라
 * 변환 없이 겹친다. 블록 안에 그리므로 지적도와 함께 XCLIP(패널 경계) 대상이 된다.
 * DrawTarget이 addLWPolyline/addText만 지원하므로 표고점 마커는 작은 마름모 폴리라인으로 그린다.
 */
function drawTopoIntoMap(dxf: DrawTarget, topoEntities: TopoEntity[], queryBBox: BBox) {
  const extent = Math.max(queryBBox.maxX - queryBBox.minX, queryBBox.maxY - queryBBox.minY)
  const labelH = Math.max(extent * 0.012, 0.2)
  let contourLabelCount = 0

  for (const e of topoEntities) {
    const layer = TOPO_CATEGORY_LAYER[e.category]
    if (!layer) continue

    if (e.category === "표고점") {
      const p = e.points[0]
      if (!p) continue
      const [x, y] = p
      const s = labelH * 0.35
      // 작은 마름모 마커
      dxf.addLWPolyline(
        [
          { point: point2d(x, y + s) },
          { point: point2d(x + s, y) },
          { point: point2d(x, y - s) },
          { point: point2d(x - s, y) },
        ],
        { layerName: layer, flags: LWPolylineFlags.Closed }
      )
      if (e.elevation !== undefined) {
        addAlignedText(
          dxf,
          x + s * 1.6,
          y,
          labelH,
          e.elevation.toFixed(1),
          layer,
          TextHorizontalAlignment.Left,
          TextVerticalAlignment.Middle
        )
      }
      continue
    }

    if (e.points.length < 2) continue
    const closed = e.category === "건물"
    dxf.addLWPolyline(
      e.points.map(([x, y]) => ({ point: point2d(x, y) })),
      { layerName: layer, flags: closed ? LWPolylineFlags.Closed : 0 }
    )

    if (e.category === "등고선" && e.elevation !== undefined && e.points.length > 6) {
      contourLabelCount++
      if (contourLabelCount % 4 === 0) {
        const mid = e.points[Math.floor(e.points.length / 2)]
        addCenteredText(dxf, mid[0], mid[1], labelH, String(Math.round(e.elevation)), LAYER_TOPO_CONTOUR)
      }
    }
  }
}

/**
 * 대상 필지 + 주변 필지를 queryBBox가 위치한 실좌표 그대로 그린다 (경계선 + 지번 라벨)
 */
function drawParcelMap(dxf: DrawTarget, target: ParcelGeometry, neighbors: NeighborParcel[], queryBBox: BBox) {
  const extent = Math.max(queryBBox.maxX - queryBBox.minX, queryBBox.maxY - queryBBox.minY)
  const targetLabelHeight = Math.max(extent * 0.025, 0.3)
  const neighborLabelHeight = Math.max(targetLabelHeight * 0.6, 0.2)
  const targetLineWidth = Math.max(extent * 0.002, 0.1)

  for (const parcel of neighbors) {
    drawPolygons(dxf, parcel.polygons, LAYER_NEIGHBOR_BOUNDARY)
    const centroid = outerRingCentroid(parcel.polygons)
    if (centroid && parcel.지번) {
      addCenteredText(dxf, centroid[0], centroid[1], neighborLabelHeight, parcel.지번, LAYER_NEIGHBOR_LABEL)
    }
  }

  // 대상 필지는 마지막에 그려서 주변 필지 위에 덮이지 않게
  drawPolygons(dxf, target.polygons, LAYER_TARGET_BOUNDARY, targetLineWidth)
  const targetCentroid = outerRingCentroid(target.polygons)
  if (targetCentroid) {
    addCenteredText(
      dxf,
      targetCentroid[0],
      targetCentroid[1],
      targetLabelHeight,
      target.지번 || target.pnu,
      LAYER_TARGET_LABEL
    )
  }

  return { targetLabelHeight }
}

export function buildCadastralDxf(target: ParcelGeometry, neighbors: NeighborParcel[], queryBBox: BBox): string {
  const dxf = new DxfWriter()
  registerFontStyle(dxf)
  registerMapLayers(dxf)

  const { targetLabelHeight } = drawParcelMap(dxf, target, neighbors, queryBBox)
  const noteHeight = Math.max(targetLabelHeight * 0.4, 0.15)
  const noteY = queryBBox.minY - targetLabelHeight * 2
  const noteX = (queryBBox.minX + queryBBox.maxX) / 2
  const note = `출처: 브이월드(국토교통부) 2D데이터API(LP_PA_CBND_BUBUN) / 좌표계: ${target.crs} / 참고용 — 법적 효력 있는 지적측량성과가 아님`

  addAlignedText(
    dxf,
    noteX,
    noteY,
    noteHeight,
    note,
    LAYER_NOTE,
    TextHorizontalAlignment.Center,
    TextVerticalAlignment.Top
  )

  return dxf.stringify()
}

export interface LandReportInfo {
  요청주소?: string
  PNU: string
  법정동명: string
  지번: string
  지목: string
  면적: string
  소유구분: string
  용도지역지구: string[]
  공시기준연도: string
  제곱미터당공시지가: string
  버퍼미터: number
  좌표계: string
  생성일시: string
  /**
   * 지자체 조례 자동조회 결과 — 항상 문자열로 채워서 넘길 것(성공값 또는 "자동조회 실패..." 메시지).
   */
  조례최대건폐율?: string
  조례최대용적율?: string
  조례조경계획?: string
  조례주차계획?: string
  /**
   * 국가법령 상한 — 호출부(land-report-dxf.ts)가 national-law.ts로 실시간 조회를 먼저 시도하고,
   * 실패하면 zoning-standards.ts 정적 상수로 이미 폴백해서 넘긴다. 여기서는 항상 채워진
   * 문자열로 받는다(주차는 별표 파싱이 아직 없어 zoning-standards.ts 상수를 직접 씀).
   */
  법정최대건폐율?: string
  법정최대용적율?: string
  법정조경계획?: string
}

function drawPanelBorder(dxf: DxfWriter, minX: number, minY: number, maxX: number, maxY: number) {
  dxf.addLWPolyline(
    [
      { point: point2d(minX, minY) },
      { point: point2d(maxX, minY) },
      { point: point2d(maxX, maxY) },
      { point: point2d(minX, maxY) },
    ],
    { layerName: LAYER_PANEL_BORDER, flags: LWPolylineFlags.Closed }
  )
}

/** 패널 상단의 다이아몬드 아이콘 (흰색 solid hatch) */
function drawTitleIcon(dxf: DxfWriter, cx: number, cy: number, radius: number) {
  const boundary = new HatchBoundaryPaths()
  const ring = new HatchPolylineBoundary([
    vertex(cx, cy + radius),
    vertex(cx + radius, cy),
    vertex(cx, cy - radius),
    vertex(cx - radius, cy),
  ])
  boundary.addPolylineBoundary(ring)
  dxf.addHatch(boundary, pattern({ name: HatchPredefinedPatterns.SOLID }), {
    layerName: LAYER_PANEL_TITLE_ICON,
  })
}

/**
 * 패널 상단 타이틀 행: 흰 다이아몬드 아이콘 + 초록 제목 + 노랑 이중 밑줄.
 * boxTopY가 밑줄(=콘텐츠 박스 상단 경계) 위치이고, 그 위로 titleRowH만큼 아이콘/제목이 올라간다.
 */
function drawPanelHeader(dxf: DxfWriter, x0: number, x1: number, boxTopY: number, titleRowH: number, title: string) {
  const iconRadius = titleRowH * 0.3
  const midY = boxTopY + titleRowH * 0.5
  const iconCx = x0 + titleRowH * 0.55

  drawTitleIcon(dxf, iconCx, midY, iconRadius)

  addAlignedText(
    dxf,
    x0 + titleRowH * 1.15,
    midY,
    titleRowH * 0.5,
    title,
    LAYER_PANEL_TITLE,
    TextHorizontalAlignment.Left,
    TextVerticalAlignment.Middle
  )

  const ruleGap = titleRowH * 0.08
  for (const y of [boxTopY, boxTopY - ruleGap]) {
    dxf.addLine(point3d(x0, y, 0), point3d(x1, y, 0), { layerName: LAYER_PANEL_TITLE_RULE })
  }
}

/**
 * 값 텍스트가 칸(1줄) 안에 들어오도록 폭 기준으로 잘라내고 말줄임표를 붙인다.
 * DXF 폰트 실제 글리프 폭을 모르니 "돋움 글자 하나 폭 ≈ 글자높이의 0.85배"로 근사한다 —
 * 정밀하진 않지만 칸을 넘어가는 것(=표가 깨져 보이는 것)을 막는 게 목적이라 보수적으로 잡는다.
 */
/** 값 텍스트가 valueColWidth 폭에서 대략 몇 줄로 줄바꿈될지 추정 (돋움 글자 폭 ≈ 글자높이의 0.85배로 근사) */
function estimateWrappedLines(value: string, valueColWidth: number, textHeight: number): number {
  const approxCharWidth = textHeight * 0.85
  const charsPerLine = Math.max(4, Math.floor(valueColWidth / approxCharWidth))
  return Math.max(1, Math.ceil(value.length / charsPerLine))
}

/**
 * 표 형식 정보 패널 (라벨 | 값) — 값이 길면 줄이지 않고 줄바꿈해서 다 보여주는 대신,
 * 그 행의 높이를 추정 줄수만큼 늘려서(다른 행에서 빌려와) 겹치지 않게 한다.
 * 짧은 값은 기존처럼 가운데 정렬 한 줄, 긴 값은 MTEXT로 위쪽 정렬 + 줄바꿈.
 */
function drawInfoTable(
  dxf: DxfWriter,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rows: [string, string][],
  maxTextHeight: number
) {
  const labelColX = x0 + (x1 - x0) * 0.34
  const cellPad = (x1 - x0) * 0.02
  const valueColWidth = x1 - (labelColX + cellPad) - cellPad

  // 텍스트 크기는 "모든 행이 1줄일 때" 기준 높이로 정하고, 실제 줄수 추정은 이 크기로 계산한다.
  // 긴 값이 있는 행이 줄바꿈되면서 그만큼 다른 행에서 높이를 빌려오므로, 짧은 행도 살짝 줄어들긴
  // 하지만 텍스트 크기 자체는 이 기준값보다 커지지 않아 겹칠 일은 없다.
  const baseRowH = (y1 - y0) / rows.length
  const textHeight = Math.min(maxTextHeight, baseRowH * 0.32)
  const lineHeight = textHeight * 1.5

  const lineCounts = rows.map(([, value]) => estimateWrappedLines(value, valueColWidth, textHeight))
  const weights = lineCounts.map((n) => Math.max(1, n))
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  const totalH = y1 - y0

  dxf.addLine(point3d(labelColX, y0, 0), point3d(labelColX, y1, 0), { layerName: LAYER_TABLE_GRID })

  let rowTop = y1
  rows.forEach(([label, value], i) => {
    const rowH = totalH * (weights[i] / totalWeight)
    const rowBottom = rowTop - rowH
    const midY = rowTop - rowH / 2

    if (i > 0) {
      dxf.addLine(point3d(x0, rowTop, 0), point3d(x1, rowTop, 0), { layerName: LAYER_TABLE_GRID })
    }

    addCenteredText(dxf, (x0 + labelColX) / 2, midY, textHeight, label, LAYER_PANEL_TEXT)

    if (lineCounts[i] <= 1) {
      addAlignedText(
        dxf,
        labelColX + cellPad,
        midY,
        textHeight,
        value,
        LAYER_PANEL_TEXT,
        TextHorizontalAlignment.Left,
        TextVerticalAlignment.Middle
      )
    } else {
      const textBlockH = lineCounts[i] * lineHeight
      const startY = rowTop - Math.max(0, (rowH - textBlockH) / 2) // 세로로도 대략 가운데 오게
      useFont(
        dxf.addMText(point3d(labelColX + cellPad, startY, 0), textHeight, value, {
          layerName: LAYER_PANEL_TEXT,
          attachmentPoint: MTextAttachmentPoint.TopLeft,
          width: valueColWidth,
        })
      )
    }

    rowTop = rowBottom
  })
}

export interface LandReportDxf {
  dxfText: string
  /** 지적도 블록 이름 — XCLIP 후처리(applyXclip)에서 이 블록을 참조하는 INSERT를 찾을 때 사용 */
  mapBlockName: string
  /** XCLIP 클립 경계로 쓸 지적도 패널의 실좌표 사각형 */
  mapClipBox: BBox
}

/**
 * 좌: 요청 정보(표) / 우상단: 토지이용계획 / 우하단: 지적도(블록 참조) — 한 페이지 구성 DXF
 * 지적도는 실좌표(EPSG:5186 등) 그대로 두고, 텍스트 패널은 그 주변에 같은 좌표계 단위로 배치한다.
 * 지적도는 BLOCK+INSERT로만 감싸서 반환하고, 실제 XCLIP(SPATIAL_FILTER) 부착은
 * applyXclip()이 파일 저장 후 별도 후처리로 수행한다.
 */
export function buildLandReportDxf(
  target: ParcelGeometry,
  neighbors: NeighborParcel[],
  queryBBox: BBox,
  info: LandReportInfo,
  topoEntities?: TopoEntity[]
): LandReportDxf {
  const dxf = new DxfWriter()
  registerFontStyle(dxf)
  registerMapLayers(dxf)
  if (topoEntities && topoEntities.length > 0) registerTopoLayers(dxf)
  dxf.addLayer(LAYER_PANEL_BORDER, Colors.Cyan, "CONTINUOUS")
  dxf.addLayer(LAYER_PANEL_TEXT, Colors.Green, "CONTINUOUS")
  dxf.addLayer(LAYER_PANEL_TITLE, Colors.Green, "CONTINUOUS")
  dxf.addLayer(LAYER_PANEL_TITLE_ICON, Colors.White, "CONTINUOUS")
  dxf.addLayer(LAYER_PANEL_TITLE_RULE, Colors.Yellow, "CONTINUOUS")
  dxf.addLayer(LAYER_TABLE_GRID, Colors.Cyan, "CONTINUOUS")

  const mapW = queryBBox.maxX - queryBBox.minX
  const mapH = queryBBox.maxY - queryBBox.minY
  const gap = mapW * 0.08
  const smallGap = gap * 0.35
  const titleRowH = Math.max(mapW * 0.045, 1)
  const topPanelH = mapH * 0.75
  const leftPanelW = mapW * 0.9
  const textHeight = Math.max(mapW * 0.014, 0.25)

  // 우하단: 지적도 — 블록으로 그린 뒤 (0,0,0)에 삽입, 패널 테두리를 XCLIP 경계로 사용해
  // 박스 밖으로 삐져나가는 필지(도로 등)를 실제 AutoCAD 공간 필터로 잘라낸다
  const mapX0 = queryBBox.minX
  const mapX1 = queryBBox.maxX
  const mapY0 = queryBBox.minY
  const mapY1 = queryBBox.maxY
  const mapBlock = dxf.addBlock(MAP_BLOCK_NAME)
  // 지형을 먼저 그려 배경으로 깔고, 지적 경계를 그 위에 그려 필지선이 잘 보이게 한다.
  if (topoEntities && topoEntities.length > 0) drawTopoIntoMap(mapBlock, topoEntities, queryBBox)
  drawParcelMap(mapBlock, target, neighbors, queryBBox)
  dxf.addInsert(MAP_BLOCK_NAME, point3d(0, 0, 0))
  drawPanelBorder(dxf, mapX0, mapY0, mapX1, mapY1)
  drawPanelHeader(dxf, mapX0, mapX1, mapY1, titleRowH, "지적도")

  // 우상단: 토지이용계획
  const rtMinX = mapX0
  const rtMaxX = mapX1
  const rtMinY = mapY1 + titleRowH + smallGap
  const rtMaxY = rtMinY + topPanelH
  drawPanelBorder(dxf, rtMinX, rtMinY, rtMaxX, rtMaxY)
  drawPanelHeader(dxf, rtMinX, rtMaxX, rtMaxY, titleRowH, "토지이용계획")

  const zoneText = info.용도지역지구.length > 0 ? info.용도지역지구.join(", ") : "조회 결과 없음"
  const landUseRows: [string, string][] = [
    ["법정동", info.법정동명 || "-"],
    ["지번", info.지번 || "-"],
    ["지목", info.지목 || "-"],
    ["면적", info.면적 ? `${info.면적} m2` : "-"],
    ["소유구분", info.소유구분 || "-"],
    ["지역/지구", zoneText],
    ["개별공시지가", info.제곱미터당공시지가 ? `${info.제곱미터당공시지가} 원/m2 (${info.공시기준연도})` : "조회 결과 없음"],
  ]
  drawInfoTable(dxf, rtMinX, rtMinY, rtMaxX, rtMaxY, landUseRows, textHeight)

  // 좌: 요청 정보 — 표 형식 (우측 두 패널 전체 높이에 맞춰 배치, 타이틀 행 상단이 토지이용계획 타이틀과 같은 높이)
  const leftMaxX = rtMinX - gap
  const leftMinX = leftMaxX - leftPanelW
  const leftMinY = mapY0
  const leftMaxY = rtMaxY
  drawPanelBorder(dxf, leftMinX, leftMinY, leftMaxX, leftMaxY)
  drawPanelHeader(dxf, leftMinX, leftMaxX, leftMaxY, titleRowH, "요청 정보")

  const tableRows: [string, string][] = [
    ["대지위치", info.요청주소 || `${info.법정동명} ${info.지번}`.trim() || "-"],
    ["대지면적", info.면적 ? `${info.면적} m2` : "-"],
    ["지목", info.지목 || "-"],
    ["지역/지구", zoneText],
    ["전면도로", "-"],
    ["접도길이", "-"],
    ["최대건폐율(법령)", info.법정최대건폐율 || buildingCoverageCell(info.용도지역지구)],
    ["최대건폐율(조례)", info.조례최대건폐율 || "자동조회 실패 — 관할 지자체 확인 필요"],
    ["최대용적률(법령)", info.법정최대용적율 || floorAreaRatioCell(info.용도지역지구)],
    ["최대용적률(조례)", info.조례최대용적율 || "자동조회 실패 — 관할 지자체 확인 필요"],
    ["조경계획(법령)", info.법정조경계획 || landscapeCell(info.용도지역지구)],
    ["조경계획(조례)", info.조례조경계획 || "자동조회 실패 — 관할 지자체 확인 필요"],
    ["주차계획(법령)", PARKING_STANDARD_CELL],
    ["주차계획(조례)", info.조례주차계획 || "자동조회 실패 — 관할 지자체 확인 필요"],
  ]
  // 표가 좌측 패널 전체 높이를 그대로 씀 (별도 하단 안내문 없음)
  drawInfoTable(dxf, leftMinX, leftMinY, leftMaxX, leftMaxY, tableRows, textHeight)

  return {
    dxfText: dxf.stringify(),
    mapBlockName: MAP_BLOCK_NAME,
    mapClipBox: { minX: mapX0, minY: mapY0, maxX: mapX1, maxY: mapY1 },
  }
}

export function countVertices(parcel: ParcelGeometry): number {
  return parcel.polygons.reduce((sum, polygon) => sum + polygon.reduce((s, ring) => s + ring.length, 0), 0)
}
