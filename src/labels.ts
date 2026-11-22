import { db } from './db.js'
import { inTransaction } from './store.js'

// A served word's reader spelling: the corpus's most common form, accents back ("decisão"),
// capitalised ("Flávio") or in capitals ("STF") when the corpus nearly always writes it so.
export const CAPITALISED = 0.9
export const UPPERCASE = 0.8

const ACCENTED = 'áàâãäéèêëíìîïóòôõöúùûüçñ'
const PLAIN = 'aaaaaeeeeiiiiooooouuuucn'

export const termLabelsQuery = `
  insert into term_labels (term, label)
  with keys as (
    select distinct w as key from (
      select term from graph_terms union select term from term_weeks
    ) t, unnest(string_to_array(t.term, ' ')) w
  ), toks as (
    select lower(s) as low, s ~ '^[[:upper:]]' as cap, s ~ '^[[:upper:]]+$' as up,
      translate(lower(s), '${ACCENTED}', '${PLAIN}') as key
    from docs, regexp_split_to_table(docs.text, '[^[:alnum:]]+') s
    where length(s) >= 2
  ), counted as (
    select t.key, t.low, count(*) as c, count(*) filter (where t.cap) as caps, count(*) filter (where t.up) as ups
    from toks t join keys k on k.key = t.key
    group by t.key, t.low
  ), ranked as (
    select key, low,
      sum(c) over (partition by key) as total,
      sum(caps) over (partition by key) as caps,
      sum(ups) over (partition by key) as ups,
      row_number() over (partition by key order by c desc, low) as rn
    from counted
  ), labelled as (
    select key,
      case
        when ups::float8 / total > ${UPPERCASE} and length(low) <= 5 then upper(low)
        when caps::float8 / total > ${CAPITALISED} then upper(left(low, 1)) || substr(low, 2)
        else low
      end as label
    from ranked where rn = 1
  )
  select key, label from labelled where label <> key`

// One transaction: a reader never sees the table half rebuilt.
export const buildTermLabels = async (): Promise<number> =>
  inTransaction(async () => {
    await db.exec('delete from term_labels')
    await db.exec(termLabelsQuery)
    const { rows } = await db.query<{ n: number }>('select count(*)::int as n from term_labels')
    return rows[0].n
  })

export const labelsFor = async (): Promise<Record<string, string>> => {
  const { rows } = await db.query<{ term: string; label: string }>('select term, label from term_labels order by term')
  return Object.fromEntries(rows.map((r) => [r.term, r.label]))
}
