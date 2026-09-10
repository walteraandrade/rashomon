// A tagged template that numbers its own parameters. `sql\`... ${v} ...\`` binds v as the next
// `$N` and returns the text with its values; a fragment interpolated into another is spliced in
// and its binds renumbered, so a helper never needs to be told which `$N` it got. A value used
// in two places is bound twice, and so is a fragment: Postgres infers each placeholder's type
// from its own context, which is what lets `${days}::int` and `make_interval(days => ${days})`
// coexist without one deciding for the other.
//
// In-house rather than a dependency: `pg` ships no tag and PGlite's is PGlite-only.

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

// Text spliced verbatim, never bound: identifiers and column references, which a placeholder
// cannot stand for. Only ever called with literals from this codebase.
const raw = (text: string): Sql => render([text])

const join = (fragments: readonly Sql[], separator = ', '): Sql =>
  render(fragments.flatMap((f, i) => (i ? [separator, ...f[PIECES]] : [...f[PIECES]])))

export const sql = Object.assign(tag, { raw, join })
