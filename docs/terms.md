# Terms, phrases and outlets

How a document becomes the words on the map, and what the labels around them mean. Extraction lives in `src/extract.ts`, the collocation lexicon in `src/phrases.ts`, the scoring SQL in `src/graph.ts`.

## The PMI universe

`pmi` is log2 of how much more often a term co-occurs with a person than chance would give. What "chance" means is the whole question, and here it is the docs in the window that mention at least one tracked person.

Terms are only stored for docs that mention at least one tracked person. A doc naming nobody tracked keeps its `docs` row (it still feeds `/api/candidates` and the source counts) but gets no `doc_terms` rows: they used to serve only as the PMI denominator, at two thirds of the largest table. PMI therefore compares a person's terms against the docs about tracked people in the window, not against everything collected; `stats.docs` keeps its old meaning (every doc in scope).

`pnpm purge orphan-terms` deletes the term rows a database collected before this rule and runs `vacuum full doc_terms` to return the pages to disk (plain `vacuum` only marks them reusable and leaves the file the same size). It takes an exclusive lock on `doc_terms`, so run it with the server stopped; it is a one-off per database, and `pnpm reindex` produces the same result from scratch. `pnpm purge <source>` does the same for the tables its cascade empties.

## Phrases

A `phrase` term is several words read as one unit, and there are two kinds of them.

**Proper nouns** need nothing but the text. `capitalizedRuns` in `src/extract.ts` — the same
heuristic `/api/candidates` uses — reads a run of two or more capitalized words, particles
allowed inside, that does not open a sentence. "Alexandre de Moraes" is one term whether or not
anyone ever adds him to `seed.json`.

**Collocations** need the corpus. `pnpm reindex` counts every adjacent pair of content words
into `phrase_stage` (one row per word occurrence; the row whose `w2` is null is the last word of
a text, and exists so the unigram counts are exact), then keeps the pairs that clear two floors:

- `MIN_PHRASE_COUNT` occurrences, default 5. PMI-shaped measures are wildest where counts are
  smallest, which is the same reason `sort=pmi` multiplies by `ln(1 + count)`.
- `MIN_PHRASE_PERCENT` stickiness, default 35. Stickiness is `c(a b) / min(c(a), c(b))`: of every
  time the rarer of the two words appears, how often is it inside this pair? "turno" has almost
  nowhere else to be, so "primeiro turno" is kept; "dias" is everywhere, so "faltam dias" is not.
  Deliberately not PMI, whose denominator rewards two rare words that co-occur once.

Adjacency is measured after stopwords are dropped, so "primeiro do turno" feeds the same pair as
"primeiro turno". Only pairs — longer units come from the proper-noun path.

The phrase replaces its words. Letting "primeiro", "turno" and "primeiro turno" compete for the
same map spends three slots on one idea, so a word occurrence a phrase covers yields no `word`
row. It is positional, not by word: "a reforma avança; a reforma tributária passa" still yields
"reforma", because one of its two occurrences is outside the phrase. `doc_terms` records
presence, so a word only leaves a document when *every* occurrence of it there is inside a
phrase. The cost is that a word's document count now means "documents where it appears at least
once outside every phrase", which is why a reindex has to run whole: half a corpus on the old
rule and half on the new one would make both counts incomparable.

A pair touching a tracked person's own name never enters the lexicon. `graph.ts` would hide it
from that person's own graph, and since the phrase replaces its words, "lula defende" as a
phrase would delete "defende" from Lula's map and put nothing in its place. Multi-word names
still reach the map through the proper-noun path, which spells them whole.

A database that predates this needs one `pnpm reindex` to gain phrases at all, and the same run is what rewrites the word rows under the substitution rule. Until it runs, the corpus carries no `phrase` row and every word still counts as it always did.

`pnpm reindex` reads the corpus twice, and has to: which pairs stick is a fact about the whole
corpus, so no document can be tagged until every document has been counted. Deriving the phrase
rows in SQL from the staging table instead would put a second extraction path beside `derive`,
which is the drift `derive` exists to prevent. `pnpm ingest` does not rebuild the lexicon; it
loads whatever the last reindex left and tags new documents with it, so a pair that only becomes
a phrase because of today's collection is tagged by the next reindex.

A phrase carrying one of a person's own name words is dropped from that person's own graph, the
way `nameTokens` already dropped the bare words: "lula defende" and "jair bolsonaro" are not
things said *about* the person, they are the person. `src/graph.ts` does it with an array-overlap
test on the phrase's words, guarded by a `position(' ' in term)` check so the single-word rows
that dominate `doc_terms` never pay for it.

## Candidate discovery

Names are discovered when a doc is inserted (`insertDoc`) and stored in `doc_candidates (doc_id, name)`, normalized like aliases (lowercase, no accents). `gkg` docs take the V1Persons column of the GKG CSV (index 11), kept in `docs.extra_names`; every other source uses a cheap, noisy heuristic: runs of two or more capitalized words (`de/da/do/das/dos` allowed inside) that do not open a sentence, where only `.`, `!`, `?` and a line break end a sentence and a colon, comma, quote or dash merely ends the run. A name equal to a tracked alias or `exclude` entry is not a candidate (exact match, so "Michelle Bolsonaro" still surfaces while only a bare "Bolsonaro" is tracked). `pnpm reindex` recomputes the table from stored docs with the current `seed.json`; gkg rows inserted before this table existed have an empty `extra_names` and contribute no candidates until re-ingested.

## Editorial lean

`outlets.json` (repo root) labels a handful of domains with a researched editorial `lean` (`left`/`right`/`center`) and a `basis`: `third_party_consensus` (an outside source describes the outlet's line) or `self_declared` (the outlet's own claim about itself, no independent audit found). Each entry also carries a `note` and `sources` (citation URLs), kept for humans reading the file, not echoed in API responses — a client wanting the citations reads `outlets.json` directly.

This is metadata about a *source*, resolved fresh from the static file on every request; it is never written into the `docs` table or backfilled onto stored rows, the same way GDELT `tone` is never guessed for a non-GDELT doc. `lean`/`domain` matching is exact-string equality against `docs.domain` (no subdomain or fuzzy matching).

**A `lean` label is a researched editorial judgment call with cited sources, not a fact.** It can be wrong, outdated, or contested; read the `note`/`sources` in `outlets.json` before treating it as more than a starting point. **A domain's absence from `outlets.json` never implies neutrality or a lack of bias** — it means nobody has researched and labeled that outlet yet, nothing more. Only five domains are labeled today; `outlets.json` only ever labels whole domains, never individual authors or sections.

## Domain and tone

Every doc stores `domain`: outlet host for news (`gnews` uses the `<source>` element, not the Google redirect link), author handle for Bluesky. `tone` comes only from GDELT GKG (V2Tone, first field, roughly -10..+10; political news sits around -1). Other sources have `tone = null`. A doc keeps the source that first stored it, so a later GKG row sharing the URL never adds tone to an rss/gnews doc. Outlet names are stripped from Google News text so they do not become terms.

`pnpm purge <source>` deletes that source's docs (and resets `gkg_files` for `gkg`), for a clean re-fetch.

