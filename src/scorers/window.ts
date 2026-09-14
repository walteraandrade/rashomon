import { aliasRe, normalize } from '../extract.js'

// The text kikori sees for one (text, person) pair: a window of SCORED_CHARS around the first
// alias mention, cut at word boundaries. A text that fits, or one where no alias matches, goes
// through whole and the caller's token cut keeps its head, as before. Both `pnpm score` and
// `pnpm export-docs` build the text here, so training data and production agree by construction.
// 900 characters is about the 250 text tokens left by max_length 256 (issue #154).
export const SCORED_CHARS = 900

type Span = { start: number; end: number }

// normalize() can change a string's length, so the search runs on a copy folded one code
// point at a time, with `at` mapping every folded index back to the original one.
const folded = (text: string) => {
  let norm = ''
  const at: number[] = []
  let i = 0
  for (const cp of text) {
    const n = normalize(cp)
    norm += n
    for (let k = 0; k < n.length; k++) at.push(i)
    i += cp.length
  }
  at.push(text.length)
  return { norm, at }
}

export const firstMention = (text: string, aliases: string[]): Span | null => {
  const { norm, at } = folded(text)
  return aliases
    .filter((alias) => normalize(alias).trim())
    .map((alias) => aliasRe(alias).exec(norm))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ start: at[m.index], end: at[m.index + m[0].length] }))
    .sort((a, b) => a.start - b.start || b.end - a.end)[0] ?? null
}

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c)

// Snap inward only: the window never grows past the budget, and never past the mention.
const snapStart = (text: string, start: number, limit: number) => {
  if (start === 0 || isSpace(text[start - 1]) || isSpace(text[start])) return start
  const next = text.slice(start).search(/\s/)
  return next === -1 || start + next > limit ? start : start + next + 1
}
const snapEnd = (text: string, end: number, limit: number) => {
  if (end >= text.length || isSpace(text[end]) || isSpace(text[end - 1])) return end
  const prev = text.slice(0, end).search(/\s\S*$/)
  return prev === -1 || prev < limit ? end : prev
}

export const scoredText = (text: string, aliases: string[], budget = SCORED_CHARS): string => {
  if (text.length <= budget) return text
  const hit = firstMention(text, aliases)
  if (!hit) return text
  const centre = Math.floor((hit.start + hit.end) / 2)
  const start = Math.min(Math.max(centre - Math.floor(budget / 2), 0), text.length - budget)
  const end = start + budget
  return text.slice(snapStart(text, start, hit.start), snapEnd(text, end, hit.end)).trim()
}
