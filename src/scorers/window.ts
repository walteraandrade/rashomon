import { aliasSpans, normalize, type Span } from '../extract.js'
import type { Person } from '../types.js'

// The text kikori sees for one (text, person) pair: the largest window around the first mention
// of the person that fits the caller's token budget, cut at word boundaries. `fits` says whether
// a candidate fits: the scorer asks its tokenizer, the export asks approxTokens. The head cut in
// pairIds then has nothing left to remove, so the mention is inside by construction, whatever the
// characters-per-token of the text. Both `pnpm score` and `pnpm export-docs` build the text here
// (issue #154). A text with no mention gives its head, cut to the same budget.
export const MAX_LENGTH = 256
export type Fits = (text: string) => boolean

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

// Mentions are found the way tagging finds them (aliasSpans): every longer alias, another
// person's or one of this person's own `exclude` names, claims its span first, so Jair
// Bolsonaro's window never centres on "Flávio Bolsonaro" and Ciro Gomes's never on "Ciro
// Nogueira". `person` stands in for its own id in `persons`, so its aliases and exclude list
// come from the caller even when the list holds a stale copy.
export const firstMention = (text: string, person: Person, persons: Person[] = []): Span | null => {
  const { norm, at } = folded(text)
  const spans = aliasSpans(norm, [...persons.filter((p) => p.id !== person.id), person]).get(person.id) ?? []
  const first = [...spans].sort((a, b) => a.start - b.start)[0]
  return first ? { start: at[first.start], end: at[first.end] } : null
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

const RESOLUTION = 16
const GUESS = 1024

// Largest budget below `max` that `ok` accepts, to within RESOLUTION characters; ok(max) is
// known to fail. Gallops from GUESS (about 250 tokens of prose), then bisects, so a long text
// costs a dozen tokenizations of window-sized strings, never one of the whole text.
const largest = (ok: (budget: number) => boolean, max: number): number => {
  let lo = 0
  let hi = max
  const probe = (b: number) => {
    const fits = ok(b)
    if (fits) lo = b
    else hi = b
    return fits
  }
  if (max > 1) probe(Math.min(GUESS, max - 1))
  while (lo > 0 && lo * 2 < hi && probe(lo * 2));
  while (lo === 0 && hi > RESOLUTION && !probe(hi >> 1));
  while (hi - lo > RESOLUTION) probe((lo + hi) >> 1)
  return lo
}

export const scoredText = (text: string, person: Person, persons: Person[], fits: Fits): string => {
  if (fits(text)) return text
  const hit = firstMention(text, person, persons) ?? { start: 0, end: 0 }
  const centre = Math.floor((hit.start + hit.end) / 2)
  const window = (budget: number) => {
    const start = Math.min(Math.max(centre - Math.floor(budget / 2), 0), Math.max(0, text.length - budget))
    const end = Math.min(start + budget, text.length)
    return text.slice(snapStart(text, start, hit.start), snapEnd(text, end, hit.end)).trim()
  }
  return window(largest((budget) => fits(window(budget)), text.length))
}

// Token count without the tokenizer, for the export, which runs without the model. WordPiece
// piece counts per class of word, calibrated on the 2026-09-11 export against kikori's own
// tokenizer: within 10% of the real count on nine long docs in ten, on every long source
// (test/window.test.ts pins three samples). A run with no whitespace and three or more
// symbols, or a URL, is code: its words split far more than prose does.
const pieces = (w: string, code: boolean): number =>
  /^\p{N}+$/u.test(w)
    ? Math.ceil(w.length / 2)
    : !/^\p{L}+$/u.test(w)
      ? 1 + Math.floor(w.length / 2)
      : code
        ? Math.ceil(w.length / 3)
        : w.length > 1 && w === w.toUpperCase()
          ? Math.round(w.length * 0.7)
          : w === w.toLowerCase()
            ? Math.ceil(w.length / 8)
            : Math.ceil(w.length / 6)

const chunkTokens = (chunk: string): number => {
  const code = chunk.includes('://') || (chunk.match(/[^\p{L}\p{N}]/gu)?.length ?? 0) >= 3
  return chunk.split(/([^\p{L}\p{N}]+)/u).reduce((n, x) => n + (!x ? 0 : /^[^\p{L}\p{N}]+$/u.test(x) ? x.length : pieces(x, code)), 0)
}

export const approxTokens = (text: string): number => text.split(/\s+/).filter(Boolean).reduce((n, chunk) => n + chunkTokens(chunk), 0)

// The export's `fits`: the same budget pairIds leaves for the text, max_length minus the
// person's tokens and the three specials, with approxTokens standing in for the tokenizer.
export const fitsApprox = (person: Person, maxLength = MAX_LENGTH): Fits => {
  const budget = maxLength - approxTokens(person.name) - 3
  return (text) => approxTokens(text) <= budget
}
