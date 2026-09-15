// DOM-free SVG builders shared by every figure's painter in render.ts: the <svg> frame, the
// horizontal axis (a line plus its ticks) and the "N didn't fit" overflow list. Pure markup,
// built only with format.ts's html tag; render.ts is the only importer.

import { html, type Html } from './format.js'

export type FrameOpts = {
  cls: string
  width?: number
  height?: number
  viewBox: string
  role?: string
  ariaLabel?: string
}

export const frame = ({ cls, width, height, viewBox, role, ariaLabel }: FrameOpts, children: Html): Html =>
  html`<svg class="${cls}" viewBox="${viewBox}"${width !== undefined ? html` width="${width}"` : ''}${height !== undefined ? html` height="${height}"` : ''}${role ? html` role="${role}"` : ''}${ariaLabel ? html` aria-label="${ariaLabel}"` : ''}>${children}</svg>`

export type AxisTick = { x: number }

export type AxisOpts = {
  x0: number
  x1: number
  y: number
  ticks: AxisTick[]
  cls: string
}

export const axis = ({ x0, x1, y, ticks, cls }: AxisOpts): Html =>
  html`<line class="${cls}-axis" x1="${x0}" x2="${x1}" y1="${y}" y2="${y}"/>${ticks.map(
    (t) => html`<line class="${cls}-tick" x1="${t.x}" x2="${t.x}" y1="${y - 5}" y2="${y + 5}"/>`,
  )}`

export type OverflowListOpts<T> = {
  items: T[]
  cls: string
  // Already-built markup: the two callers word the "N didn't fit" sentence differently
  // (a full sentence for the ruler, a bare eyebrow for the week column), so the builder takes
  // the finished intro rather than trying to parameterize the copy itself.
  intro: Html
  renderItem: (item: T) => Html
}

export const overflowList = <T>({ items, cls, intro, renderItem }: OverflowListOpts<T>): Html | '' =>
  items.length ? html`<div class="${cls}-overflow">${intro}${items.map(renderItem)}</div>` : ''
