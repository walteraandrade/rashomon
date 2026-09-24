import { sql, type Sql } from './sql.js'

// `count`/`about`/`col` are raw column references the caller supplies (sql.raw), never bound values.
export const pmiRank = (count: Sql): Sql => sql`pmi * ln(1 + ${count})`

export const sortKey = (sort: string, count: Sql): Sql =>
  sql`(case when ${sort} = 'pmi' then ${pmiRank(count)} else ${count} end)`

export const signatureFloor = (about: Sql): Sql => sql`greatest(3, ${about} * 0.05)`

// A bare-word match, or a phrase whose split carries one of the names.
export const isName = (col: Sql, names: string[]): Sql =>
  sql`(${col} = any(${names}::text[]) or (position(' ' in ${col}) > 0 and string_to_array(${col}, ' ') && ${names}::text[]))`
