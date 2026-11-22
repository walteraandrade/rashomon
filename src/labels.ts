import { db } from './db.js'
import { inTransaction } from './store.js'

// A served word's reader spelling: the corpus's most common form, accents back ("decisão"),
// capitalised ("Flávio") or in capitals ("STF") when the corpus nearly always writes it so.
export const CAPITALISED = 0.9
export const UPPERCASE = 0.8

// URLs and handles cut and every combining mark stripped from the key, as extract.ts does; NFC so a
// decomposed accent never splits a word. Served words' tokens only, once for both statements.
export const labelTokensQuery = `
  create temp table label_toks on commit drop as
  with served as (
    select term from graph_terms union select term from term_weeks
  ), keys as (
    select distinct w as key from served, unnest(string_to_array(served.term, ' ')) w
  ), raw as (
    select d.id, regexp_replace(normalize(d.text, NFC), 'https?://\\S+|[#@]\\S+', ' ', 'g') as t
    from docs d where d.country is distinct from 'pt'
  ), toks as (
    select r.id, s.ord, s.tok, lower(s.tok) as low,
      regexp_replace(normalize(lower(s.tok), NFD), '[\u0300-\u036f]', '', 'g') as key
    from raw r, regexp_split_to_table(r.t, '[^[:alnum:]]+') with ordinality s(tok, ord)
    where s.tok <> ''
  )
  select t.* from toks t join keys k on k.key = t.key`

// A word: its most common lower-case form, capitalised when the corpus nearly always is, in
// capitals when a short word is mostly written so (a headline "STF" never yields "Stf").
export const termLabelsQuery = `
  insert into term_labels (term, label)
  with counted as (
    select t.key, t.low, count(*) as c,
      count(*) filter (where t.tok ~ '^[[:upper:]]') as caps,
      count(*) filter (where t.tok ~ '^[[:upper:]]+$' and length(t.tok) > 1) as ups
    from label_toks t
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
        when length(low) <= 5 and (ups::float8 / total > ${UPPERCASE} or (caps::float8 / total > ${CAPITALISED} and ups::float8 / nullif(caps, 0) > 0.5)) then upper(low)
        when caps::float8 / total > ${CAPITALISED} then upper(left(low, 1)) || substr(low, 2)
        else low
      end as label
    from ranked where rn = 1
  )
  select key, label from labelled where label <> key`

// A phrase is spelled whole (per word, "São Paulo" would take the verb "são"), all-caps forms last,
// and stored even when equal to its key; only one written as 2-4 adjacent words gets an entry.
export const phraseLabelsQuery = `
  insert into term_labels (term, label)
  with phrases as (
    select term from graph_terms where position(' ' in term) > 0
    union select term from term_weeks where position(' ' in term) > 0
  ), words as (
    select distinct w as key from phrases, unnest(string_to_array(phrases.term, ' ')) w
  ), kept as (
    select t.* from label_toks t join words w on w.key = t.key
  ), grams as (
    select
      case when lead(ord, 1) over w = ord + 1 then key || ' ' || lead(key, 1) over w end as k2,
      tok || ' ' || lead(tok, 1) over w as r2,
      case when lead(ord, 2) over w = ord + 2 then key || ' ' || lead(key, 1) over w || ' ' || lead(key, 2) over w end as k3,
      tok || ' ' || lead(tok, 1) over w || ' ' || lead(tok, 2) over w as r3,
      case when lead(ord, 3) over w = ord + 3 then key || ' ' || lead(key, 1) over w || ' ' || lead(key, 2) over w || ' ' || lead(key, 3) over w end as k4,
      tok || ' ' || lead(tok, 1) over w || ' ' || lead(tok, 2) over w || ' ' || lead(tok, 3) over w as r4
    from kept window w as (partition by id order by ord)
  ), seen as (
    select k2 as key, r2 as form from grams union all
    select k3, r3 from grams union all
    select k4, r4 from grams
  ), ranked as (
    select s.key, s.form, row_number() over (
      partition by s.key order by (s.form = upper(s.form) and s.form <> lower(s.form)), count(*) desc, s.form
    ) as rn
    from seen s join phrases p on p.term = s.key
    group by s.key, s.form
  )
  select key, form from ranked where rn = 1`

// One transaction, so a reader never sees the table half rebuilt; work_mem as the window builds.
export const buildTermLabels = async (): Promise<number> =>
  inTransaction(async () => {
    await db.exec(`set local work_mem = '128MB'`)
    await db.exec(labelTokensQuery)
    await db.exec('delete from term_labels')
    await db.exec(termLabelsQuery)
    await db.exec(phraseLabelsQuery)
    const { rows } = await db.query<{ n: number }>('select count(*)::int as n from term_labels')
    return rows[0].n
  })

export const labelsFor = async (): Promise<Record<string, string>> => {
  const { rows } = await db.query<{ term: string; label: string }>('select term, label from term_labels order by term')
  return Object.fromEntries(rows.map((r) => [r.term, r.label]))
}
