import { sql, type Sql } from './sql.js'

// `count`/`about`/`col` are raw column references the caller supplies (sql.raw), never bound values.
export const pmiRank = (count: Sql): Sql => sql`pmi * ln(1 + ${count})`

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

// A Bluesky doc's `domain` is its author's handle, an account rather than an outlet, so every
// ranking of outlets (`/sources`, `/testimony`'s by_domain, `/agenda`) reads it as null. A
// `domain=<handle>` filter on `/docs` or a `domain:<handle>` lens still matches the stored value.
export const outletDomain: Sql = sql`(case when d.source = 'bluesky' then null else d.domain end)`
