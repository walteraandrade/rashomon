import { siteFile } from './pages.js'

export type Rule = { selectors: string[]; decls: Map<string, string> }

export const atlasCss = () => siteFile('atlas.css')

// Flat rules only: a rule inside an @media block is read like a top-level one, which is all these checks need.
export const rulesOf = (css: string): Rule[] =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
    decls: new Map(
      m[2]
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()] as [string, string]),
    ),
  }))

export const rulesFor = (rules: Rule[], selector: string) => rules.filter((r) => r.selectors.includes(selector))

export const declared = (rules: Rule[], selector: string, prop: string): string | undefined =>
  rulesFor(rules, selector).flatMap((r) => (r.decls.has(prop) ? [r.decls.get(prop)!] : [])).at(-1)

export const tokensOf = (css: string): Map<string, string> => {
  const root = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/:root\s*\{([^}]*)\}/)![1]
  return new Map([...root.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}

type Rgb = [number, number, number]

const splitTop = (s: string) => {
  const out: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') depth--
    else if (s[i] === ',' && depth === 0) {
      out.push(s.slice(from, i).trim())
      from = i + 1
    }
  }
  out.push(s.slice(from).trim())
  return out
}

const hex = (h: string): Rgb => {
  const v = h.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as Rgb
}

// Resolves hex, var(--x[, fallback]) and color-mix(in srgb, A p%, B), the only colour forms the figures use.
export const colorOf = (expr: string, vars: Map<string, string>): Rgb => {
  const e = expr.trim()
  if (e.startsWith('#')) return hex(e)
  const v = e.match(/^var\((--[a-z0-9-]+)(?:\s*,\s*(.+))?\)$/)
  if (v) {
    const value = vars.get(v[1]) ?? v[2]
    if (value === undefined) throw new Error(`unresolved ${v[1]}`)
    return colorOf(value, vars)
  }
  const mix = e.match(/^color-mix\(in srgb,(.*)\)$/s)
  if (!mix) throw new Error(`cannot resolve ${e}`)
  const [a, b] = splitTop(mix[1])
  const part = (s: string) => {
    const m = s.match(/^(.*?)\s+(\d+(?:\.\d+)?)%$/)
    return m ? { color: colorOf(m[1], vars), pct: Number(m[2]) / 100 } : { color: colorOf(s, vars), pct: null }
  }
  const pa = part(a)
  const pb = part(b)
  const wa = pa.pct ?? 1 - (pb.pct ?? 0.5)
  return pa.color.map((c, i) => c * wa + pb.color[i] * (1 - wa)) as Rgb
}

const lum = ([r, g, b]: Rgb) => {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

export const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
