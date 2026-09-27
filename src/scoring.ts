import { sql, type Sql } from './sql.js'

// `count`/`about`/`col` are raw column references the caller supplies (sql.raw), never bound values.
export const pmiRank = (count: Sql): Sql => sql`pmi * ln(1 + ${count})`

// The raw PMI, before pmiRank's ln(1+count) and before rounding. graphFast and
// personTermsQuery keep their own ::float8 copies: the fast statement's text is pinned,
// and the build writes those same floats. Neither calls this.
export const pmiLog2 = (cPt: Sql, nTotal: Sql, npTotal: Sql, cT: Sql): Sql =>
  sql`ln((${cPt} * ${nTotal}) / (${npTotal} * ${cT})) / ln(2)`

export const sortKey = (sort: string, count: Sql): Sql =>
  sql`(case when ${sort} = 'pmi' then ${pmiRank(count)} else ${count} end)`

export const signatureFloor = (about: Sql): Sql => sql`greatest(3, ${about} * 0.05)`

// A bare-word match, or a phrase whose split carries one of the names.
export const isName = (col: Sql, names: string[]): Sql =>
  sql`(${col} = any(${names}::text[]) or (position(' ' in ${col}) > 0 and string_to_array(${col}, ' ') && ${names}::text[]))`

// Bound as a value, not branched in JS, so rendered SQL shape never depends on which country was
// requested. 'br' keeps null-country docs too (`is distinct from`); 'pt' excludes them; 'all' is unfiltered.
export const countryFilter = (country: 'br' | 'pt' | 'all'): Sql =>
  sql`(${country} = 'all' or (${country} = 'pt' and d.country = 'pt') or (${country} = 'br' and d.country is distinct from 'pt'))`
