import { foldTestimonyDomains, type TestimonyDomainRow } from './format.js'

export const RANK_MAX_ROWS = 20
export const RANK_MIN_WIDTH = 420
export const RANK_AXIS = 5
export const RANK_PITCH = 22
export const RANK_N_COL = 56
export const RANK_LABEL_MIN = 96
export const RANK_LABEL_MAX = 220
export const RANK_R_MIN = 3
export const RANK_R_MAX = 9
// Header band above the first row: the person's mean label sits in it.
export const RANK_TOP = 26
const RANK_AXIS_BAND = 44
// IBM Plex Mono advances 0.6 em; labels are set at --t-2xs (12px).
const CHAR_WIDTH = 12 * 0.6
const LABEL_PAD = 8
const TICK_VALUES = [-RANK_AXIS, -RANK_AXIS / 2, 0, RANK_AXIS / 2, RANK_AXIS]

export type Clipped = -1 | 0 | 1

const clipOf = (score: number): Clipped => (score < -RANK_AXIS ? -1 : score > RANK_AXIS ? 1 : 0)

const tickLabel = (value: number) => {
  if (value === 0) return '0'
  const body = String(Math.abs(value)).replace('.', ',')
  return `${value < 0 ? '−' : '+'}${body}`
}

const truncate = (domain: string, labelCol: number) => {
  const fits = Math.floor((labelCol - LABEL_PAD) / CHAR_WIDTH + 1e-9)
  if (domain.length <= fits) return { label: domain, truncated: false }
  return { label: `${domain.slice(0, Math.max(0, fits - 1))}…`, truncated: true }
}

// The axis and its frame, shared by the drawn rows and the ghost.
export const rankFrame = (containerWidth: number, rowCount: number) => {
  const svgWidth = Math.max(RANK_MIN_WIDTH, containerWidth)
  const labelCol = Math.min(RANK_LABEL_MAX, Math.max(RANK_LABEL_MIN, 0.28 * containerWidth))
  const plot = { left: labelCol, right: svgWidth - RANK_N_COL }
  const x = (score: number) => plot.left + ((Math.max(-RANK_AXIS, Math.min(RANK_AXIS, score)) + RANK_AXIS) / (2 * RANK_AXIS)) * (plot.right - plot.left)
  const rowsBottom = RANK_TOP + rowCount * RANK_PITCH
  return {
    svgWidth,
    width: svgWidth,
    labelCol,
    plot,
    x,
    ticks: TICK_VALUES.map((value) => ({ value, x: x(value), label: tickLabel(value) })),
    zero: x(0),
    top: RANK_TOP,
    rowsBottom,
    axisY: rowsBottom + 4,
    height: rowsBottom + RANK_AXIS_BAND,
  }
}

export const rankedRows = (rows: TestimonyDomainRow[], containerWidth: number, overall: number | null = null) => {
  const folded = foldTestimonyDomains(rows).slice(0, RANK_MAX_ROWS)
  const frame = rankFrame(containerWidth, folded.length)
  const nMax = folded.reduce((m, d) => Math.max(m, d.n), 0)
  return {
    ...frame,
    rows: folded.map((d, i) => ({
      domain: d.domain,
      ...truncate(d.domain, frame.labelCol),
      sources: d.sources,
      score: d.score,
      n: d.n,
      x: frame.x(d.score),
      clipped: clipOf(d.score),
      r: RANK_R_MIN + (RANK_R_MAX - RANK_R_MIN) * Math.sqrt(d.n / nMax),
      y: RANK_TOP + i * RANK_PITCH + RANK_PITCH / 2,
    })),
    mean: overall === null ? null : { x: frame.x(overall), clipped: clipOf(overall) },
  }
}

// Centre of a label kept inside the chart, by the same 0.6 em rule as the row labels.
export const meanLabelX = (x: number, text: string, svgWidth: number) => {
  const half = (text.length * CHAR_WIDTH) / 2
  return Math.max(half, Math.min(svgWidth - half, x))
}

// A small triangle just past the dot, pointing out of the axis.
export const arrowPoints = (x: number, y: number, r: number, dir: 1 | -1) => {
  const base = x + dir * (r + 2)
  const tip = x + dir * (r + 8)
  return `${base},${y - 4} ${tip},${y} ${base},${y + 4}`
}
