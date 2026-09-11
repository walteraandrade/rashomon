// Tagged template that numbers its own parameters. A fragment interpolated into another is
// spliced in and its binds renumbered. A value used twice is bound twice; cast where Postgres
// needs type context. In-house: `pg` ships no tag and PGlite's is PGlite-only.

const PIECES = Symbol('sql.pieces')

type Piece = string | { readonly bind: unknown }

export type Sql = {
  readonly text: string
  readonly values: unknown[]
  readonly [PIECES]: readonly Piece[]
}

const isSql = (v: unknown): v is Sql => typeof v === 'object' && v !== null && PIECES in v

const render = (pieces: readonly Piece[]): Sql => {
  const values: unknown[] = []
  const text = pieces.map((p) => (typeof p === 'string' ? p : `$${values.push(p.bind)}`)).join('')
  return { text, values, [PIECES]: pieces }
}

const piecesOf = (v: unknown): readonly Piece[] => (isSql(v) ? v[PIECES] : [{ bind: v }])

const tag = (strings: TemplateStringsArray, ...values: unknown[]): Sql =>
  render(strings.flatMap((s, i) => (i < values.length ? [s, ...piecesOf(values[i])] : [s])))

// Spliced verbatim, never bound: for identifiers and column references.
const raw = (text: string): Sql => render([text])

const join = (fragments: readonly Sql[], separator = ', '): Sql =>
  render(fragments.flatMap((f, i) => (i ? [separator, ...f[PIECES]] : [...f[PIECES]])))

export const sql = Object.assign(tag, { raw, join })
